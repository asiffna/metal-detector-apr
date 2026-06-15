import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { IETR_DATA } from "./data.js?v=25";

const MODEL_URL = "assets/new_sborka.glb?v=25";
const MARKER_TARGETS = {
  case: ["case", "case-1"],
  grille: ["eBom-prt36", "eBom-prt36-1"],
  membrane: ["eBom-prt36", "eBom-prt36-1"],
  gland: ["eBom-prt36", "eBom-prt36-1"],
  coilCable: ["eBom-prt36", "eBom-prt36-1"],
  pcb: ["pcb"],
  resistors: ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "R10", "R11", "R12", "R13", "R14", "R15", "R16", "R17", "R18", "R19", "R20", "R21", "R22"],
  capacitors: ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10", "C11", "C12", "C13", "C14"],
  diodes: ["D1", "D2", "D3"],
  transistors: ["VT1", "VT2", "VT3", "VT4", "VT5", "VT6"],
  connectors: ["XP1", "V1", "LS1", "RV1"],
  fasteners: ["pcb", "case", "case-1"],
  v1: ["V1"],
  xp1: ["XP1"],
  cover: ["cover", "cover-1"],
  rv1: ["RV1"],
  ls1: ["LS1"],
  r22: ["R22"]
};

const STAGE_LABELS = {
  board: {
    title: "Монтаж платы",
    code: "Операции 030-045 маршрутной карты"
  },
  product: {
    title: "Сборка изделия",
    code: "Операции 050-060 маршрутной карты"
  }
};

const state = {
  activeSection: "passport",
  activeStep: 0,
  activeComponent: null,
  autoTimer: null,
  autoRotate: false,
  manualCoverOpen: false,
  manualBoardLifted: false,
  markerPositions: new Map(),
  modelReady: false,
  cameraTween: null,
  activeFocus: null,
  activeTargets: [],
  highlightedMaterials: [],
  modelDiagnostics: [],
  pointerDown: null
};

const els = {
  nav: document.querySelector("#sectionNav"),
  info: document.querySelector("#infoContent"),
  viewerTitle: document.querySelector("#viewerTitle"),
  activeMode: document.querySelector("#activeMode"),
  viewer: document.querySelector("#viewer"),
  modelState: document.querySelector("#modelState"),
  markerLayer: document.querySelector("#markerLayer"),
  stepCounter: document.querySelector("#stepCounter"),
  stepZone: document.querySelector("#stepZone"),
  progressFill: document.querySelector("#progressFill"),
  prevStep: document.querySelector("#prevStepBtn"),
  nextStep: document.querySelector("#nextStepBtn"),
  autoPlay: document.querySelector("#autoPlayBtn"),
  resetStep: document.querySelector("#resetStepBtn"),
  resetView: document.querySelector("#resetViewBtn"),
  toggleRotate: document.querySelector("#toggleRotateBtn"),
  toggleCover: document.querySelector("#toggleCoverBtn"),
  toggleBoard: document.querySelector("#toggleBoardBtn")
};

const three = {
  scene: null,
  camera: null,
  renderer: null,
  controls: null,
  model: null,
  modelObjects: new Map(),
  originalTransforms: new Map(),
  raycaster: new THREE.Raycaster(),
  pointer: new THREE.Vector2(),
  modelCenter: new THREE.Vector3(),
  modelBounds: new THREE.Box3(),
  modelSize: new THREE.Vector3(),
  modelScale: 1,
  grid: null,
  highlight: null,
  focusRing: null,
  selectionBox: null
};

init();

function init() {
  renderNav();
  init3D();
  renderSection("passport");
  bindControls();
}

function bindControls() {
  els.prevStep.addEventListener("click", () => goToStep(state.activeStep - 1));
  els.nextStep.addEventListener("click", () => goToStep(state.activeStep + 1));
  els.resetStep.addEventListener("click", () => {
    pauseAuto();
    goToStep(0);
  });
  els.autoPlay.addEventListener("click", () => {
    if (state.autoTimer) {
      pauseAuto();
    } else {
      playAuto();
    }
  });
  els.resetView.addEventListener("click", () => setCameraPreset("overview"));
  els.toggleRotate.addEventListener("click", () => {
    state.autoRotate = !state.autoRotate;
    if (three.controls) three.controls.autoRotate = state.autoRotate;
    els.toggleRotate.classList.toggle("is-on", state.autoRotate);
  });
  els.toggleCover.addEventListener("click", () => {
    state.manualCoverOpen = !state.manualCoverOpen;
    applyCurrentViewState();
    updateViewerTools();
  });
  els.toggleBoard.addEventListener("click", () => {
    state.manualBoardLifted = !state.manualBoardLifted;
    applyCurrentViewState();
    updateViewerTools();
  });
  window.addEventListener("resize", resizeRenderer);
}

function renderNav() {
  els.nav.innerHTML = IETR_DATA.sections
    .map(
      (section) => `
        <button class="nav-button" type="button" data-section="${section.id}">
          <span class="nav-num">${section.number}</span>
          <span>${section.label}</span>
        </button>
      `
    )
    .join("");

  els.nav.querySelectorAll("[data-section]").forEach((button) => {
    button.addEventListener("click", () => renderSection(button.dataset.section));
  });
}

function renderSection(sectionId) {
  state.activeSection = sectionId;
  if (sectionId !== "composition") {
    state.activeComponent = null;
  }
  if (sectionId !== "assembly") {
    pauseAuto();
  }
  const section = IETR_DATA.sections.find((item) => item.id === sectionId);
  els.activeMode.textContent = section?.label || "ИЭТР";
  clearTransientSelection();
  updateViewerTools();

  document.querySelectorAll(".nav-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.section === sectionId);
  });

  if (sectionId === "assembly") {
    els.viewerTitle.textContent = "Интерактивная сборка";
    renderAssembly();
    goToStep(state.activeStep);
    return;
  }

  const currentStep = IETR_DATA.assemblySteps[state.activeStep];
  updateProcedureMeta(currentStep);

  const renderers = {
    passport: renderPassport,
    composition: renderComposition,
    operation: renderOperation,
    tuning: renderTuning,
    safety: renderSafety,
    maintenance: renderMaintenance,
    troubleshooting: renderTroubleshooting
  };

  els.viewerTitle.textContent = section?.label || "3D-макет изделия";
  els.info.innerHTML = renderers[sectionId] ? renderers[sectionId]() : "";
  if (sectionId === "composition") {
    bindCompositionPanel();
  }
  applyCurrentViewState();
  setCameraPreset(sectionId === "composition" ? "overview" : "front");
}

function renderPassport() {
  return `
    <article class="panel-card">
      <span class="eyebrow">${IETR_DATA.product.classLabel}</span>
      <h2>${IETR_DATA.product.title}</h2>
      <p>${IETR_DATA.product.purpose}</p>
      <p class="muted">Исполнители: ${IETR_DATA.product.team}</p>
    </article>
    <div class="grid-cards">
      ${IETR_DATA.specs
        .map(
          (spec) => `
            <div class="stat-card">
              <span>${spec.label}</span>
              <b>${spec.value}</b>
              <span>${spec.detail}</span>
            </div>
          `
        )
        .join("")}
    </div>
    <div class="warning-card">
      <strong>Ограничение по IP54*</strong>
      <p>${IETR_DATA.product.note}</p>
    </div>
  `;
}

function renderComposition() {
  if (state.activeComponent) {
    const component = IETR_DATA.components.find((item) => item.id === state.activeComponent);
    if (component) {
      return `
        <article class="step-card">
          <span class="eyebrow">${component.group}</span>
          <h2>${component.name}</h2>
          <p>${component.description}</p>
          <div class="panel-card">
            <span class="mini-label">Контроль</span>
            <p>${component.control}</p>
          </div>
          <div class="step-actions">
            <button type="button" id="backToCompositionList">Назад к составу</button>
          </div>
        </article>
      `;
    }
  }

  return `
    <article class="panel-card">
      <h2>Состав изделия</h2>
      <p>Раздел показывает основные узлы прототипа. Выбирайте элемент из списка или кликом по 3D-модели. Для изучения платы можно открыть крышку и временно извлечь плату.</p>
    </article>
    <div class="component-list">
      ${IETR_DATA.components
        .map(
          (component) => `
            <button class="component-card" type="button" data-component="${component.id}">
              <h3>${component.name}</h3>
              <span>${component.group}</span>
            </button>
          `
        )
        .join("")}
    </div>
  `;
}

function renderAssembly() {
  const steps = IETR_DATA.assemblySteps;
  const groupedSteps = Object.entries(STAGE_LABELS).map(([stageId, stage]) => ({
    stageId,
    ...stage,
    steps: steps
      .map((step, index) => ({ ...step, index }))
      .filter((step) => step.stage === stageId)
  }));
  els.info.innerHTML = `
    <article class="step-card">
      <span class="eyebrow" id="stepStage"></span>
      <h2 id="stepTitle"></h2>
      <p id="stepAction"></p>
      <div class="panel-card">
        <span class="mini-label">Контроль</span>
        <p id="stepControl"></p>
      </div>
      <div class="warning-card">
        <strong>Предупреждение</strong>
        <p id="stepWarning"></p>
      </div>
    </article>
    <article class="panel-card">
      <h3>Сценарий ИЭТР</h3>
      <div class="stage-list">
        ${groupedSteps
          .map(
            (group) => `
              <section class="stage-group">
                <div class="stage-heading">
                  <strong>${group.title}</strong>
                  <span>${group.code}</span>
                </div>
                <ol class="ordered-steps">
                  ${group.steps
                    .map(
                      (step) => `
                        <li data-step="${step.index}">
                          <button type="button" data-step-button="${step.index}">
                            <span class="step-index">${step.index + 1}</span>
                            <span>${step.title}</span>
                          </button>
                        </li>
                      `
                    )
                    .join("")}
                </ol>
              </section>
            `
          )
          .join("")}
      </div>
    </article>
  `;

  els.info.querySelectorAll("[data-step-button]").forEach((button) => {
    button.addEventListener("click", () => {
      pauseAuto();
      goToStep(Number(button.dataset.stepButton));
    });
  });
}

function renderOperation() {
  return `
    <article class="panel-card">
      <h2>Эксплуатация</h2>
      <p>Работа допускается при температуре от -10 до +45 °C и влажности до 80 % при +25 °C без конденсата.</p>
    </article>
    <ol class="ordered-steps">
      ${IETR_DATA.operation
        .map(
          (item, index) => `
            <li>
              <span class="step-index">${index + 1}</span>
              <span>${item}</span>
            </li>
          `
        )
        .join("")}
    </ol>
    <div class="logic-chain">
      <div class="logic-node"><strong>Нет металла</strong><br />Режим тишины или минимальный звуковой отклик.</div>
      <div class="logic-node"><strong>Металл в зоне поиска</strong><br />Появляется звуковой сигнал.</div>
      <div class="logic-node"><strong>Приближение к объекту</strong><br />Частота звукового сигнала повышается.</div>
    </div>
  `;
}

function renderTuning() {
  return `
    <article class="panel-card">
      <h2>Настройка нулевых биений</h2>
      <p>Настройка выполняется потенциометром RV1 при отсутствии металлических предметов в зоне поисковой катушки.</p>
    </article>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Действие</th><th>Результат</th></tr></thead>
        <tbody>
          ${IETR_DATA.tuning
            .map((row) => `<tr><td>${row.action}</td><td>${row.result}</td></tr>`)
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderSafety() {
  return `
    <article class="panel-card">
      <h2>Безопасность</h2>
      <p>Основные риски для прототипа связаны не с поражением током, а с коротким замыканием, повреждением кабеля, влагой, пылью и механическими дефектами корпуса.</p>
    </article>
    <div class="component-list">
      ${IETR_DATA.safetyCards
        .map(
          (card) => `
            <div class="panel-card">
              <h3>${card.title}</h3>
              <p>${card.text}</p>
            </div>
          `
        )
        .join("")}
    </div>
    <div class="warning-card">
      <strong>IP54*</strong>
      <p>Проектная оценка требует подтверждения испытаниями. Погружение, сильные струи воды и длительный дождь не допускаются.</p>
    </div>
  `;
}

function renderMaintenance() {
  return `
    <article class="panel-card">
      <h2>Техническое обслуживание</h2>
      <p>Среднее время восстановления задано не более 30 минут. В ИЭТР показаны только базовые действия: осмотр, замена батареи и проверка соединений.</p>
    </article>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Периодичность</th><th>Действие</th></tr></thead>
        <tbody>
          ${IETR_DATA.maintenance
            .map((row) => `<tr><td>${row.period}</td><td>${row.action}</td></tr>`)
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderTroubleshooting() {
  return `
    <article class="panel-card">
      <h2>Неисправности</h2>
      <p>При любых работах внутри корпуса сначала отключить питание и снять батарею.</p>
    </article>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Признак</th><th>Возможная причина</th><th>Действие</th></tr></thead>
        <tbody>
          ${IETR_DATA.faults
            .map(
              (row) => `
                <tr>
                  <td>${row.symptom}</td>
                  <td>${row.reason}</td>
                  <td>${row.action}</td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderReference() {
  return `
    <article class="panel-card">
      <h2>Справка</h2>
      <p>ИЭТР представляет структурированный комплекс технических данных с интерактивным отображением процедур эксплуатации, обслуживания и сборки изделия.</p>
    </article>
    <div class="panel-card">
      <h3>Использованные данные</h3>
      <ul>
        ${IETR_DATA.references.map((item) => `<li>${item}</li>`).join("")}
      </ul>
    </div>
  `;
}

function goToStep(index) {
  const steps = IETR_DATA.assemblySteps;
  if (index < 0) index = steps.length - 1;
  if (index >= steps.length) index = 0;
  state.activeStep = index;

  const step = steps[index];
  if (state.activeSection !== "assembly") {
    updateProcedureMeta(step);
    applyCurrentViewState();
    return;
  }

  if (!document.querySelector("#stepTitle")) {
    renderAssembly();
  }

  const stepTitle = document.querySelector("#stepTitle");
  const stepStage = document.querySelector("#stepStage");
  const stepAction = document.querySelector("#stepAction");
  const stepControl = document.querySelector("#stepControl");
  const stepWarning = document.querySelector("#stepWarning");
  if (stepStage) {
    const stage = STAGE_LABELS[step.stage] || STAGE_LABELS.product;
    stepStage.textContent = `${stage.title} · ${stage.code}`;
  }
  if (stepTitle) stepTitle.textContent = step.title;
  if (stepAction) stepAction.textContent = `${step.action} ${step.details}`;
  if (stepControl) stepControl.textContent = step.control;
  if (stepWarning) stepWarning.textContent = step.warning;

  document.querySelectorAll("[data-step]").forEach((item) => {
    item.classList.toggle("is-active", Number(item.dataset.step) === index);
  });

  updateProcedureMeta(step);
  applyStepVisualization(step);
  setCameraPreset(step.camera);
}

function updateProcedureMeta(step) {
  const stepNumber = state.activeStep + 1;
  const total = IETR_DATA.assemblySteps.length;
  els.stepCounter.textContent = `Действие ${stepNumber} / ${total}`;
  els.stepZone.textContent = step.progressLabel || step.title;
  els.progressFill.style.width = `${(stepNumber / total) * 100}%`;
}

function playAuto() {
  els.autoPlay.classList.add("is-on");
  els.autoPlay.textContent = "Пауза";
  state.autoTimer = window.setInterval(() => {
    const next = state.activeStep + 1;
    goToStep(next >= IETR_DATA.assemblySteps.length ? 0 : next);
  }, 2200);
}

function pauseAuto() {
  if (state.autoTimer) window.clearInterval(state.autoTimer);
  state.autoTimer = null;
  els.autoPlay.classList.remove("is-on");
  els.autoPlay.textContent = "Автопроигрывание";
}

function applyStepVisualization(step) {
  resetAnimatedObjects();
  applyStageVisibility(step);
  animateStepObjects(step);

  const targets = findObjectsByNames(step.targetNames || MARKER_TARGETS[step.zone] || []);
  state.activeTargets = targets;
  highlightTargets(targets);

  state.activeFocus = getObjectsCenter(targets) || null;
}

function applyStageVisibility(step) {
  showAllModelObjects();
  const productObjects = findObjectsByNames(["case", "cover", "coilCable", "screw_pcb", "screw_lid"]);
  const showProductShell = step.stage !== "board";
  productObjects.forEach((object) => {
    object.visible = showProductShell;
  });
}

function showAllModelObjects() {
  if (!three.model) return;
  three.model.traverse((object) => {
    object.visible = true;
  });
}

function animateStepObjects(step) {
  const coverObjects = findObjectsByNames(["cover", "cover-1"]);
  const coverScrews = findObjectsByNames(["screw_lid"]);
  const pcbObjects = findObjectsByNames(["pcb"]);
  const pcbScrews = findObjectsByNames(["screw_pcb"]);
  const installBoardIndex = IETR_DATA.assemblySteps.findIndex((item) => item.stage === "product" && item.animation === "pcb");
  const coverIndex = IETR_DATA.assemblySteps.findIndex((item) => item.animation === "cover");
  const shouldLiftBoard =
    step.stage === "product" && installBoardIndex >= 0 && state.activeStep < installBoardIndex;
  const shouldOpenCover =
    (step.stage === "product" && coverIndex >= 0 && state.activeStep < coverIndex) ||
    step.stage === "board";

  if (coverObjects.length && shouldOpenCover) {
    offsetObjects(coverObjects, new THREE.Vector3(0, 0.34, -1.5));
  }
  if (coverScrews.length && shouldOpenCover) {
    offsetObjects(coverScrews, new THREE.Vector3(0, 0.34, -1.5));
  }

  if (pcbObjects.length && shouldLiftBoard) {
    offsetObjects(pcbObjects, new THREE.Vector3(0, 0.62, 0.18));
  }
  if (pcbScrews.length && shouldLiftBoard) {
    offsetObjects(pcbScrews, new THREE.Vector3(0, 0.62, 0.18));
  }

  if (step.animation === "pcb" && pcbObjects.length) {
    offsetObjects(pcbObjects, new THREE.Vector3(0, 0.08, 0));
  }

  if (step.animation === "cover" && coverObjects.length) {
    offsetObjects(coverObjects, new THREE.Vector3(0, 0.06, 0));
  }
  if (step.animation === "cover" && coverScrews.length) {
    offsetObjects(coverScrews, new THREE.Vector3(0, 0.06, 0));
  }
}

function offsetObjects(objects, offset) {
  objects.forEach((object) => {
    const parent = object.parent;
    if (!parent) {
      object.position.add(offset);
      return;
    }

    const worldPosition = new THREE.Vector3();
    object.getWorldPosition(worldPosition);
    const targetWorld = worldPosition.add(offset);
    object.position.copy(parent.worldToLocal(targetWorld));
  });
}

function bindModelPicking() {
  const canvas = three.renderer.domElement;
  canvas.addEventListener("pointerdown", (event) => {
    state.pointerDown = { x: event.clientX, y: event.clientY };
  });

  canvas.addEventListener("pointerup", (event) => {
    if (!state.pointerDown) return;
    const dx = Math.abs(event.clientX - state.pointerDown.x);
    const dy = Math.abs(event.clientY - state.pointerDown.y);
    state.pointerDown = null;
    if (dx > 4 || dy > 4) return;
    pickModelObject(event);
  });
}

function pickModelObject(event) {
  if (!state.modelReady || !["composition", "assembly"].includes(state.activeSection)) return;
  const rect = three.renderer.domElement.getBoundingClientRect();
  three.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  three.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  three.raycaster.setFromCamera(three.pointer, three.camera);

  const meshes = [];
  three.model.traverse((node) => {
    if (node.isMesh && isObjectVisible(node)) meshes.push(node);
  });

  const hit = three.raycaster.intersectObjects(meshes, false)[0];
  if (!hit) return;

  const logicalObject = findSelectableAncestor(hit.object);
  if (!logicalObject) return;

  pauseAuto();
  showModelObjectCard(logicalObject);
}

function isObjectVisible(object) {
  let node = object;
  while (node) {
    if (!node.visible) return false;
    node = node.parent;
  }
  return true;
}

function findSelectableAncestor(object) {
  let node = object;
  while (node && node !== three.model) {
    const name = node.name || "";
    const parentName = node.parent?.name || "";

    if (parentName === "pcb") return name.startsWith("Layer_") ? node.parent : node;
    if (["pcb", "case-1", "cover-2", "eBom-prt36-1"].includes(name)) return node;
    if (/^(R|C|D|VT)\d+$/i.test(name) || ["XP1", "V1", "RV1", "LS1"].includes(name)) return node;

    node = node.parent;
  }
  return null;
}

function showModelObjectCard(object) {
  if (state.activeSection === "composition") {
    state.manualCoverOpen = true;
    const name = object.name || "";
    if (object.parent?.name === "pcb" || name === "pcb" || /^(R|C|D|VT)\d+$/i.test(name) || ["XP1", "V1", "RV1", "LS1"].includes(name)) {
      state.manualBoardLifted = true;
    }
    updateViewerTools();
  }
  applyCurrentViewState();
  highlightTargets([object]);
  state.activeFocus = getObjectsCenter([object]);

  const info = describeModelObject(object.name);
  els.info.innerHTML = `
    <article class="step-card">
      <span class="eyebrow">Выбранный элемент модели</span>
      <h2>${info.title}</h2>
      <p>${info.description}</p>
      <div class="panel-card">
        <span class="mini-label">Контроль</span>
        <p>${info.control}</p>
      </div>
    </article>
  `;
}

function describeModelObject(name) {
  const normalized = name || "Элемент модели";

  if (/^R\d+$/i.test(normalized)) {
    return {
      title: `Резистор ${normalized}`,
      description: normalized.toUpperCase() === "R22"
        ? "Резистор выходной цепи; используется как контрольная зона возможного нагрева."
        : "Резистор печатной платы, установленный по электрической схеме металлоискателя.",
      control: "Проверить номинал, качество пайки и отсутствие перемычек между соседними дорожками."
    };
  }

  if (/^C\d+$/i.test(normalized)) {
    return {
      title: `Конденсатор ${normalized}`,
      description: ["C13", "C14"].includes(normalized.toUpperCase())
        ? "Полярный конденсатор. Ориентация должна соответствовать обозначению на плате."
        : "Конденсатор генераторной или вспомогательной цепи печатной платы.",
      control: "Проверить посадку, пайку и, для полярных элементов, правильность подключения плюса и минуса."
    };
  }

  if (/^D\d+$/i.test(normalized)) {
    return {
      title: `Диод ${normalized}`,
      description: normalized.toUpperCase() === "D1"
        ? "Диод базовой защиты от переполюсовки питания."
        : "Диод схемы металлоискателя, установленный с учетом направления включения.",
      control: "Проверить ориентацию полоски корпуса и качество пайки выводов."
    };
  }

  if (/^VT\d+$/i.test(normalized)) {
    return {
      title: `Транзистор ${normalized}`,
      description: "Транзистор генераторной или выходной части схемы.",
      control: "Проверить цоколевку, отсутствие перегрева при пайке и отсутствие замыканий между выводами."
    };
  }

  const named = {
    XP1: {
      title: "Разъем батареи XP1",
      description: "Вход питания 9 В постоянного тока. Батарея в CAD-модели отсутствует и учитывается условно.",
      control: "Подключать питание только при выключенном устройстве и с соблюдением полярности."
    },
    V1: {
      title: "Разъем поисковой катушки V1",
      description: "Разъем подключения готовой поисковой катушки. Полная катушка в модели отсутствует.",
      control: "Кабель не должен создавать натяжения на плате."
    },
    RV1: {
      title: "Потенциометр настройки RV1",
      description: "Орган настройки режима нулевых биений при отсутствии металла рядом с катушкой.",
      control: "Настройку выполнять вдали от металлических предметов."
    },
    LS1: {
      title: "Разъем динамика LS1",
      description: "Разъем подключения динамика. Сам динамик в CAD-модели отсутствует и показан условно.",
      control: "При приближении металла подключенный динамик должен формировать звуковой отклик."
    },
    pcb: {
      title: "Печатная плата FR-4",
      description: "Двухслойная плата с электронными компонентами металлоискателя.",
      control: "Проверить отсутствие короткого замыкания между +9 В и GND."
    },
    "case-1": {
      title: "Корпус ABS",
      description: "Основная корпусная деталь блока управления со встроенной защитной решеткой.",
      control: "Корпус должен быть без трещин, сколов и острых кромок."
    },
    "cover-2": {
      title: "Крышка корпуса",
      description: "Закрывает корпус и ограничивает доступ пользователя к проводникам платы.",
      control: "После закрытия не должно быть зазора между крышкой и корпусом."
    },
    "eBom-prt36-1": {
      title: "Зона решетки и вывода кабеля",
      description: "Общий CAD-узел, где представлены защитная решетка и зона вывода кабеля.",
      control: "Проверить решетку, мембрану, кабельный ввод и отсутствие повреждений кабеля."
    }
  };

  return named[normalized] || {
    title: normalized,
    description: "Именованный элемент GLB-модели металлоискателя.",
    control: "Проверить визуальное состояние, посадку и соответствие сборочной документации."
  };
}

function init3D() {
  three.scene = new THREE.Scene();
  three.scene.background = new THREE.Color(0x0f141b);

  three.camera = new THREE.OrthographicCamera(-2.4, 2.4, 2.4, -2.4, 0.01, 200);
  three.camera.position.set(4.2, 3.0, 5.2);

  three.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  three.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  three.renderer.outputColorSpace = THREE.SRGBColorSpace;
  els.viewer.appendChild(three.renderer.domElement);

  three.controls = new OrbitControls(three.camera, three.renderer.domElement);
  three.controls.enableDamping = true;
  three.controls.dampingFactor = 0.08;
  three.controls.autoRotateSpeed = 1.4;
  bindModelPicking();

  const ambient = new THREE.HemisphereLight(0xf3f7ff, 0x243242, 1.5);
  three.scene.add(ambient);

  const key = new THREE.DirectionalLight(0xffffff, 2.25);
  key.position.set(4, 6, 5);
  three.scene.add(key);

  const rim = new THREE.DirectionalLight(0x7aa2ff, 1.15);
  rim.position.set(-5, 3, -3);
  three.scene.add(rim);

  three.grid = new THREE.GridHelper(5.2, 18, 0x415164, 0x26303b);
  three.grid.position.y = -0.64;
  three.scene.add(three.grid);

  three.highlight = new THREE.Mesh(
    new THREE.SphereGeometry(0.055, 24, 24),
    new THREE.MeshBasicMaterial({ color: 0x4f7cff, transparent: true, opacity: 0.95, depthTest: false })
  );
  three.highlight.visible = false;
  three.highlight.renderOrder = 20;
  three.scene.add(three.highlight);

  three.focusRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.16, 0.01, 16, 72),
    new THREE.MeshBasicMaterial({ color: 0x63cdb9, transparent: true, opacity: 0.95, depthTest: false })
  );
  three.focusRing.visible = false;
  three.focusRing.renderOrder = 21;
  three.scene.add(three.focusRing);

  three.selectionBox = new THREE.Box3Helper(new THREE.Box3(), 0x4f7cff);
  three.selectionBox.visible = false;
  three.scene.add(three.selectionBox);

  resizeRenderer();
  loadModel();
  animate();
}

function loadModel() {
  const loader = new GLTFLoader();
  loader.load(
    MODEL_URL,
    (gltf) => {
      three.model = gltf.scene;
      three.scene.add(three.model);
      normalizeModel();
      indexModelObjects();
      console.table(state.modelDiagnostics);
      console.info("IETR key objects", collectKeyObjects());
      setCameraPreset("overview");
      state.modelReady = true;
      els.modelState.classList.add("is-hidden");
      goToStep(0);
    },
    undefined,
    (error) => {
      console.error(error);
      els.modelState.textContent = "Не удалось загрузить 3D-модель. Запустите сайт через localhost.";
    }
  );
}

function normalizeModel() {
  three.model.rotation.set(-Math.PI / 2, 0, 0);
  three.model.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(three.model);
  const size = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(three.modelCenter);

  const maxSide = Math.max(size.x, size.y, size.z);
  three.modelScale = 3.0 / maxSide;
  three.model.position.copy(three.modelCenter).multiplyScalar(-three.modelScale);
  three.model.scale.setScalar(three.modelScale);
  three.model.updateMatrixWorld(true);

  three.model.traverse((node) => {
    if (node.isMesh) {
      node.castShadow = true;
      node.receiveShadow = true;
      if (node.material) {
        node.material = node.material.clone();
        node.material.roughness = Math.max(node.material.roughness ?? 0.5, 0.55);
      }
    }
  });

  three.modelBounds.setFromObject(three.model);
  three.modelBounds.getSize(three.modelSize);
  rememberOriginalTransforms();
  if (three.grid) {
    three.grid.position.y = three.modelBounds.min.y - 0.06;
  }
}

function indexModelObjects() {
  three.modelObjects.clear();
  state.modelDiagnostics = [];

  three.model.traverse((node) => {
    if (!node.name) return;
    const key = normalizeObjectName(node.name);
    if (!three.modelObjects.has(key)) {
      three.modelObjects.set(key, []);
    }
    three.modelObjects.get(key).push(node);
    state.modelDiagnostics.push({
      name: node.name,
      type: node.type,
      isMesh: Boolean(node.isMesh),
      parent: node.parent?.name || ""
    });
  });
}

function normalizeObjectName(name) {
  return String(name || "").trim().toLowerCase();
}

function collectKeyObjects() {
  const keys = ["pcb", "cover", "case", "XP1", "V1", "RV1", "LS1", "R22", "eBom-prt36"];
  return Object.fromEntries(keys.map((key) => [key, findObjectsByNames([key]).map((item) => item.name)]));
}

function findObjectsByNames(names = []) {
  const candidates = [];
  const seen = new Set();
  const allNamed = [];

  three.model.traverse((node) => {
    if (node.name) allNamed.push(node);
  });

  const push = (node) => {
    if (!node || seen.has(node.uuid)) return;
    seen.add(node.uuid);
    candidates.push(node);
  };

  names.forEach((name) => {
    const target = normalizeObjectName(name);
    allNamed.filter((node) => normalizeObjectName(node.name) === target).forEach(push);
  });

  if (candidates.length) return candidates;

  names.forEach((name) => {
    const target = normalizeObjectName(name);
    allNamed.filter((node) => normalizeObjectName(node.name).startsWith(target)).forEach(push);
  });

  if (candidates.length) return candidates;

  names.forEach((name) => {
    const target = normalizeObjectName(name);
    allNamed.filter((node) => normalizeObjectName(node.name).includes(target)).forEach(push);
  });

  return candidates;
}

function rememberOriginalTransforms() {
  three.originalTransforms.clear();
  three.model.traverse((node) => {
    three.originalTransforms.set(node.uuid, {
      position: node.position.clone(),
      quaternion: node.quaternion.clone(),
      scale: node.scale.clone()
    });
  });
}

function resetAnimatedObjects() {
  three.originalTransforms.forEach((transform, uuid) => {
    const node = three.model.getObjectByProperty("uuid", uuid);
    if (!node) return;
    node.position.copy(transform.position);
    node.quaternion.copy(transform.quaternion);
    node.scale.copy(transform.scale);
  });
}

function createMarkers() {
  els.markerLayer.innerHTML = "";
  state.markerPositions.clear();
}

function getMarkerPosition(marker) {
  const targets = findObjectsByNames(MARKER_TARGETS[marker.id] || []);
  const targetCenter = getObjectsCenter(targets);
  if (targetCenter) return targetCenter;

  if (marker.anchorBox) {
    const [x, y, z] = marker.anchorBox;
    return new THREE.Vector3(
      three.modelBounds.min.x + (x + 0.5) * three.modelSize.x,
      three.modelBounds.min.y + (y + 0.5) * three.modelSize.y,
      three.modelBounds.min.z + (z + 0.5) * three.modelSize.z
    );
  }

  const original = new THREE.Vector3(...marker.anchor);
  return original.sub(three.modelCenter).multiplyScalar(three.modelScale);
}

function getObjectsBox(objects) {
  const box = new THREE.Box3();
  let hasObject = false;

  objects.forEach((object) => {
    const objectBox = new THREE.Box3().setFromObject(object);
    if (!objectBox.isEmpty()) {
      box.union(objectBox);
      hasObject = true;
    }
  });

  return hasObject ? box : null;
}

function getObjectsCenter(objects) {
  const box = getObjectsBox(objects);
  if (!box) return null;
  const center = new THREE.Vector3();
  box.getCenter(center);
  return center;
}

function selectComponent(componentId) {
  state.activeComponent = componentId;
  state.manualCoverOpen = true;
  if (
    componentId === "pcb" ||
    ["xp1", "v1", "rv1", "ls1", "r22", "resistors", "capacitors", "diodes", "transistors", "connectors"].includes(componentId)
  ) {
    state.manualBoardLifted = true;
  }
  const targets = findObjectsByNames(MARKER_TARGETS[componentId] || []);
  applyCurrentViewState();
  highlightTargets(targets);
  state.activeFocus = getObjectsCenter(targets) || null;

  els.info.innerHTML = renderComposition();
  bindCompositionPanel();
  updateViewerTools();
  /*
    <article class="step-card">
      <span class="eyebrow">${component.group}</span>
      <h2>${component.name}</h2>
      <p>${component.description}</p>
      <div class="panel-card">
        <span class="mini-label">Контроль</span>
        <p>${component.control}</p>
      </div>
    </article>
  `;
  */
}

function setMarkersMode(activeId) {
  return activeId;
}

function setActiveMarker(markerId, hideMarkerWhenObjectFound = false) {
  return [markerId, hideMarkerWhenObjectFound];
}

function highlightTargets(targets) {
  resetHighlights();

  targets.forEach((target) => {
    target.traverse((node) => {
      if (!node.isMesh || !node.material) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach((material) => {
        state.highlightedMaterials.push({
          material,
          color: material.color?.clone(),
          emissive: material.emissive?.clone(),
          opacity: material.opacity,
          transparent: material.transparent
        });
        if (material.color) material.color.lerp(new THREE.Color(0x4f7cff), 0.72);
        if (material.emissive) material.emissive.set(0x162a57);
        material.transparent = true;
        material.opacity = Math.max(material.opacity ?? 1, 0.96);
      });
      node.renderOrder = 10;
    });
  });

}

function resetHighlights() {
  state.highlightedMaterials.forEach((entry) => {
    if (entry.color && entry.material.color) entry.material.color.copy(entry.color);
    if (entry.emissive && entry.material.emissive) entry.material.emissive.copy(entry.emissive);
    entry.material.opacity = entry.opacity;
    entry.material.transparent = entry.transparent;
  });
  state.highlightedMaterials = [];
  if (three.focusRing) three.focusRing.visible = false;
  if (three.highlight) three.highlight.visible = false;
  if (three.selectionBox) three.selectionBox.visible = false;
}

function updateMarkerPositions() {
  return;
}

function setCameraPreset(name) {
  if (!three.camera || !three.controls) return;
  const preset = IETR_DATA.cameraPresets[name] || IETR_DATA.cameraPresets.overview;
  const target = new THREE.Vector3(...preset.target);
  const position = new THREE.Vector3(...preset.position);
  const currentPosition = three.camera.position.clone();
  const currentTarget = three.controls.target.clone();

  state.cameraTween = {
    startedAt: performance.now(),
    duration: 520,
    fromPosition: currentPosition,
    toPosition: position,
    fromTarget: currentTarget,
    toTarget: target
  };
}

function resizeRenderer() {
  if (!three.renderer || !three.camera) return;
  const width = els.viewer.clientWidth;
  const height = els.viewer.clientHeight;
  const aspect = width / Math.max(height, 1);
  const viewSize = 5.2;
  three.camera.left = (-viewSize * aspect) / 2;
  three.camera.right = (viewSize * aspect) / 2;
  three.camera.top = viewSize / 2;
  three.camera.bottom = -viewSize / 2;
  three.camera.updateProjectionMatrix();
  three.renderer.setSize(width, height, false);
}

function animate() {
  requestAnimationFrame(animate);
  updateCameraTween();
  updateFocusPulse();
  if (three.controls) three.controls.update();
  updateMarkerPositions();
  if (three.renderer && three.scene && three.camera) {
    three.renderer.render(three.scene, three.camera);
  }
}

function updateCameraTween() {
  if (!state.cameraTween || !three.camera || !three.controls) return;
  const elapsed = performance.now() - state.cameraTween.startedAt;
  const t = Math.min(elapsed / state.cameraTween.duration, 1);
  const eased = 1 - Math.pow(1 - t, 3);
  three.camera.position.lerpVectors(state.cameraTween.fromPosition, state.cameraTween.toPosition, eased);
  three.controls.target.lerpVectors(state.cameraTween.fromTarget, state.cameraTween.toTarget, eased);
  if (t >= 1) {
    state.cameraTween = null;
  }
}

function updateFocusPulse() {
  return;
}

function bindCompositionPanel() {
  const backButton = document.querySelector("#backToCompositionList");
  if (!backButton) return;
  backButton.addEventListener("click", () => {
    state.activeComponent = null;
    clearTransientSelection();
    applyCurrentViewState();
    els.info.innerHTML = renderComposition();
  });
}

function updateViewerTools() {
  const showMechanicalTools = state.activeSection === "composition";
  els.toggleCover.hidden = !showMechanicalTools;
  els.toggleBoard.hidden = !showMechanicalTools;
  els.toggleCover.classList.toggle("is-on", state.manualCoverOpen);
  els.toggleBoard.classList.toggle("is-on", state.manualBoardLifted);
  els.toggleCover.textContent = state.manualCoverOpen ? "Закрыть крышку" : "Открыть крышку";
  els.toggleBoard.textContent = state.manualBoardLifted ? "Вернуть плату" : "Достать плату";
}

function clearTransientSelection() {
  state.activeFocus = null;
  state.activeTargets = [];
  resetHighlights();
}

function applyCurrentViewState() {
  if (!state.modelReady) return;
  resetAnimatedObjects();
  showAllModelObjects();

  if (state.activeSection === "composition") {
    const coverObjects = findObjectsByNames(["cover", "cover-2"]);
    const pcbObjects = findObjectsByNames(["pcb"]);

    if (state.manualCoverOpen) {
      offsetObjects(coverObjects, new THREE.Vector3(0, 0.34, -1.5));
    }
    if (state.manualBoardLifted) {
      offsetObjects(pcbObjects, new THREE.Vector3(0, 0.62, 0.18));
    }

    if (state.activeComponent) {
      const targets = findObjectsByNames(MARKER_TARGETS[state.activeComponent] || []);
      highlightTargets(targets);
      state.activeFocus = getObjectsCenter(targets) || null;
    }
    return;
  }

  if (state.activeSection === "assembly") {
    applyStepVisualization(IETR_DATA.assemblySteps[state.activeStep]);
  }
}

document.addEventListener("click", (event) => {
  const componentButton = event.target.closest("[data-component]");
  if (componentButton) {
    selectComponent(componentButton.dataset.component);
  }
});

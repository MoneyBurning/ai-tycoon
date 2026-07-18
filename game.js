(function () {
  "use strict";

  // =========================================================
  // 1. 게임 상태 변수
  // =========================================================
  const state = {
    money: 0,
    companyValue: 0,
    reputation: 0,
    level: 1,
    employees: {}, // { intern: [{name, personality}, ...], developer: [...], ... }
    purchasedUpgrades: [], // 구매 완료한 업그레이드 id 목록
    completedResearch: [], // 완료된 연구 id 목록 (순서대로)
    activeResearch: null, // { id, startTime, endTime, duration } | null
    completedProjects: [], // 완료된 프로젝트 id 목록 (완료되면 목록에서 제거됨)
    activeProject: null, // { id, startTime, endTime, duration } | null
    lifetimeEarnings: 0, // 이번 회차 누적 수익 (프레스티지 조건/명성 계산 기준, 매각 시 0으로 리셋)
    prestigeCount: 0, // 회사 매각 횟수 (영구 유지)
    prestigePoints: 0, // 누적 AI 명성 포인트 (영구 유지, 포인트당 전체 수익 +2%)
    temporaryEffects: [], // 랜덤 이벤트로 인한 임시 수익 배율 [{ multiplier, endTime }]
    builtBuildings: [], // 건설한 건물 id 목록 (순서 = 사무실 배치 순서, 종류당 1개)
  };

  // =========================================================
  // 4. 숫자 표기 포맷
  // =========================================================
  function formatNumber(n) {
    const num = Math.floor(n);
    const sign = num < 0 ? "-" : "";
    const abs = Math.abs(num);

    if (abs < 1000) return sign + abs;

    const units = [
      { value: 1e12, suffix: "T" },
      { value: 1e9, suffix: "B" },
      { value: 1e6, suffix: "M" },
      { value: 1e3, suffix: "K" },
    ];
    const unit = units.find((u) => abs >= u.value);
    return sign + (abs / unit.value).toFixed(1) + unit.suffix;
  }

  // =========================================================
  // 상단바 요소 찾기 (index.html에 id가 없으므로 아이콘으로 식별)
  // =========================================================
  function findStatValueByIcon(icon) {
    const items = document.querySelectorAll(".stat-item");
    for (const item of items) {
      const iconEl = item.querySelector(".stat-icon");
      if (iconEl && iconEl.textContent.trim() === icon) {
        return item.querySelector(".stat-value");
      }
    }
    return null;
  }

  let moneyEl = null;
  let companyValueEl = null;
  let reputationEl = null;
  let levelEl = null;
  let incomeRateEl = null;

  // =========================================================
  // 2. 화면 업데이트 함수
  // =========================================================
  function updateDisplay() {
    updateGrowth();
    if (moneyEl) moneyEl.textContent = "$" + formatNumber(state.money);
    if (companyValueEl) companyValueEl.textContent = "$" + formatNumber(state.companyValue);
    if (reputationEl) reputationEl.textContent = formatNumber(state.reputation);
    if (levelEl) levelEl.textContent = "Lv." + state.level;
    if (incomeRateEl) incomeRateEl.textContent = "$" + formatNumber(getIncomePerSecond());
    refreshPrestigeStat();
    refreshPrestigeButton();
  }

  // 상단바에 "초당 수익" 통계 카드를 추가 (index.html을 직접 수정하지 않고
  // 기존 .stat-item과 동일한 구조로 만들어 스타일이 그대로 적용되도록 함)
  function createIncomeRateStat() {
    const headerStats = document.querySelector(".header-stats");
    if (!headerStats) return;

    const item = document.createElement("div");
    item.className = "stat-item";
    item.innerHTML = `
      <span class="stat-icon">⚡</span>
      <div class="stat-text">
        <span class="stat-label">초당 수익</span>
        <span class="stat-value">$0</span>
      </div>
    `;
    headerStats.appendChild(item);
    incomeRateEl = item.querySelector(".stat-value");
  }

  function earnMoney(amount) {
    state.money += amount;
    state.lifetimeEarnings += amount;
    updateDisplay();
    refreshEmployeeCards();
    refreshUpgradeStore();
  }

  // =========================================================
  // 3 & 5. 사무실 클릭 버튼
  // index.html/style.css 파일은 건드리지 않는다는 규칙을 지키기 위해
  // 버튼 요소와 스타일을 game.js에서 런타임에 직접 생성/삽입한다.
  // =========================================================
  function injectClickButtonStyle() {
    const style = document.createElement("style");
    style.textContent = `
      .office-controls {
        position: absolute;
        left: 50%;
        bottom: 14px;
        transform: translateX(-50%);
        display: flex;
        gap: 8px;
        z-index: 4;
      }
      .office-click-btn {
        border: none;
        padding: 14px 22px;
        font-family: "Noto Sans KR", sans-serif;
        font-size: 0.9rem;
        font-weight: 700;
        color: #ffffff;
        background: linear-gradient(135deg, #3b82f6, #1d4ed8);
        border-radius: 10px;
        cursor: pointer;
        white-space: nowrap;
        box-shadow: 0 6px 16px rgba(37, 99, 235, 0.3);
        transition: filter 0.15s ease, transform 0.08s ease, box-shadow 0.15s ease;
      }
      .office-click-btn:hover {
        filter: brightness(1.1);
        box-shadow: 0 8px 20px rgba(37, 99, 235, 0.4);
      }
      .office-click-btn:active {
        transform: scale(0.94);
        box-shadow: 0 3px 8px rgba(37, 99, 235, 0.3);
      }
    `;
    document.head.appendChild(style);
  }

  let clickButtonEl = null;

  // 사무실 하단에 항상 떠 있는 버튼 모음 (클릭 버튼 + 건설 버튼).
  // .office-placeholder는 캐릭터가 생기면 숨겨지므로, 그 안에 버튼을 두면
  // 직원을 채용한 순간부터 버튼이 사라지는 문제가 있어 별도 컨테이너로 분리했다.
  function getOrCreateOfficeControls() {
    const officeView = document.querySelector(".office-view");
    if (!officeView) return null;
    let controls = officeView.querySelector(".office-controls");
    if (!controls) {
      controls = document.createElement("div");
      controls.className = "office-controls";
      officeView.appendChild(controls);
    }
    return controls;
  }

  function createClickButton() {
    const controls = getOrCreateOfficeControls();
    if (!controls) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "office-click-btn";
    button.textContent = "💡 아이디어 내기 (+$1)";
    button.addEventListener("click", () => {
      earnMoney(getClickValue());
    });

    controls.appendChild(button);
    clickButtonEl = button;
  }

  function refreshClickButtonLabel() {
    if (clickButtonEl) {
      clickButtonEl.textContent = "💡 아이디어 내기 (+$" + getClickValue() + ")";
    }
  }

  // =========================================================
  // 직원 채용 시스템
  // =========================================================
  const employeeTypes = [
    { id: "intern", name: "AI 인턴", icon: "🤖", cost: 15, income: 1 },
    { id: "developer", name: "AI 개발자", icon: "👨‍💻", cost: 100, income: 5 },
    { id: "researcher", name: "AI 리서처", icon: "🔬", cost: 1100, income: 30 },
    { id: "architect", name: "AI 아키텍트", icon: "🏗️", cost: 12000, income: 200 },
    { id: "director", name: "AI 디렉터", icon: "🎯", cost: 130000, income: 1500 },
  ];

  // ---- 직원 개성 시스템 ----
  const nameOptions = [
    "김민준", "이서연", "박지호", "최하은", "정우진",
    "한소희", "오민재", "윤채원", "강도현", "신예린",
    "임준혁", "송지아", "배현우", "류나연", "조성민",
    "문하린", "황태양", "전소율", "남기훈", "석다은",
  ];

  const personalities = [
    { id: "passionate", name: "열정적", icon: "😤" },
    { id: "meticulous", name: "꼼꼼함", icon: "📋" },
    { id: "creative", name: "창의적", icon: "💡" },
    { id: "lazy", name: "느긋함", icon: "😴" },
  ];

  function randomName() {
    return nameOptions[Math.floor(Math.random() * nameOptions.length)];
  }

  function randomPersonality() {
    return personalities[Math.floor(Math.random() * personalities.length)].id;
  }

  function getPersonalityInfo(id) {
    return personalities.find((p) => p.id === id);
  }

  // 열정적 +20%, 느긋함 -10%, 창의적은 기대값(평소 1배·10% 확률 3배 스파이크 ≒ 평균 1.2배), 꼼꼼함은 변동 없음(1배)
  function getPersonalityMultiplier(personality) {
    switch (personality) {
      case "passionate": return 1.2;
      case "lazy": return 0.9;
      case "creative": return 1.2;
      case "meticulous":
      default: return 1.0;
    }
  }

  // 창의적 성격의 실시간 스파이크 여부 (1초마다 갱신, 저장 대상 아님)
  const creativeSpikes = new WeakMap();

  function getEmployeeList(id) {
    return state.employees[id] || [];
  }

  function getEmployeeCount(id) {
    return getEmployeeList(id).length;
  }

  function getLatestHire(id) {
    const list = getEmployeeList(id);
    return list.length > 0 ? list[list.length - 1] : null;
  }

  function getPersonalityCounts(id) {
    const counts = { passionate: 0, meticulous: 0, creative: 0, lazy: 0 };
    getEmployeeList(id).forEach((emp) => {
      counts[emp.personality] = (counts[emp.personality] || 0) + 1;
    });
    return counts;
  }

  // 랜덤 이벤트("경쟁사 스카우트" 급여 인상)로 특정 직원에게만 붙는 영구 배율
  function getEmployeeRaiseBonus(emp) {
    return emp.raiseBonus || 1;
  }

  // 기대값 기준 (화면 표시용 — 창의적 스파이크의 순간 변동은 반영하지 않아 숫자가 안정적으로 보임)
  function getTypeEmployeeIncome(type) {
    return getEmployeeList(type.id).reduce(
      (sum, emp) =>
        sum + type.income * getPersonalityMultiplier(emp.personality) * getEmployeeRaiseBonus(emp),
      0
    );
  }

  // 실시간 값 (창의적 스파이크를 실제로 반영, 자금 적립에 사용)
  function getLiveTypeEmployeeIncome(type) {
    return getEmployeeList(type.id).reduce((sum, emp) => {
      let multiplier;
      if (emp.personality === "creative") {
        multiplier = creativeSpikes.get(emp) ? 3 : 1;
      } else {
        multiplier = getPersonalityMultiplier(emp.personality);
      }
      return sum + type.income * multiplier * getEmployeeRaiseBonus(emp);
    }, 0);
  }

  function getIncomePerSecond() {
    const base = employeeTypes.reduce((sum, type) => sum + getTypeEmployeeIncome(type), 0);
    return (
      (base * getBuildingEmployeeMultiplier() + getProjectIncomeBonus()) *
      getUpgradeIncomeMultiplier() *
      getResearchMultiplier() *
      getPrestigeMultiplier() *
      getSynergyMultiplier() *
      getTemporaryEffectMultiplier() *
      getBuildingTotalMultiplier()
    );
  }

  function getLiveIncomePerSecond() {
    const base = employeeTypes.reduce((sum, type) => sum + getLiveTypeEmployeeIncome(type), 0);
    return (
      (base * getBuildingEmployeeMultiplier() + getProjectIncomeBonus()) *
      getUpgradeIncomeMultiplier() *
      getResearchMultiplier() *
      getPrestigeMultiplier() *
      getSynergyMultiplier() *
      getTemporaryEffectMultiplier() *
      getBuildingTotalMultiplier()
    );
  }

  function hireEmployee(type) {
    const personality = randomPersonality();
    const baseCost = type.cost;
    const cost = personality === "lazy" ? Math.floor(baseCost * 0.5) : baseCost;
    if (state.money < cost) return;

    state.money -= cost;
    const name = randomName();
    if (!state.employees[type.id]) state.employees[type.id] = [];
    state.employees[type.id].push({ name, personality });

    updateDisplay();
    refreshEmployeeCards();
    refreshUpgradeStore();
    refreshSynergyBar();
    syncOfficeCharacters(type.id);
  }

  // 직원 카드 DOM 참조 (매 갱신마다 다시 그리지 않고 값만 갱신하기 위해 보관)
  const employeeCardRefs = {};

  function injectEmployeeCardStyle() {
    const style = document.createElement("style");
    style.textContent = `
      .employee-card {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px;
        margin-bottom: 10px;
        background: var(--color-surface, #ffffff);
        border: 1px solid var(--color-border-blue, #d6e4fb);
        border-radius: 10px;
      }
      .employee-card:last-child {
        margin-bottom: 0;
      }
      .employee-card-icon {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: var(--color-primary-light, #eaf1ff);
        font-size: 1.2rem;
      }
      .employee-card-info {
        flex: 1;
        min-width: 0;
      }
      .employee-card-name {
        font-size: 0.85rem;
        font-weight: 700;
        color: var(--color-text, #1e293b);
      }
      .employee-card-count {
        font-weight: 700;
        color: var(--color-primary, #2563eb);
      }
      .employee-card-stats {
        font-size: 0.72rem;
        color: var(--color-text-secondary, #6b7684);
        margin-top: 2px;
      }
      .employee-card-total {
        font-size: 0.72rem;
        font-weight: 700;
        color: var(--color-primary-dark, #1d4ed8);
        margin-top: 2px;
      }
      .employee-card-latest {
        font-size: 0.68rem;
        color: var(--color-text-secondary, #6b7684);
        margin-top: 4px;
      }
      .employee-card-badges {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-top: 4px;
      }
      .personality-badge {
        font-size: 0.65rem;
        font-weight: 700;
        background: var(--color-primary-light, #eaf1ff);
        color: var(--color-primary-dark, #1d4ed8);
        border-radius: 999px;
        padding: 2px 6px;
      }
      .hire-btn {
        flex-shrink: 0;
        border: none;
        padding: 8px 12px;
        font-family: "Noto Sans KR", sans-serif;
        font-size: 0.75rem;
        font-weight: 700;
        color: #ffffff;
        background: linear-gradient(135deg, #3b82f6, #1d4ed8);
        border-radius: 8px;
        cursor: pointer;
        transition: filter 0.15s ease, transform 0.08s ease;
      }
      .hire-btn:hover:not(:disabled) {
        filter: brightness(1.1);
      }
      .hire-btn:active:not(:disabled) {
        transform: scale(0.94);
      }
      .hire-btn:disabled {
        background: #cbd5e1;
        color: #94a3b8;
        cursor: not-allowed;
      }
    `;
    document.head.appendChild(style);
  }

  function createEmployeePanel() {
    const employeesPanel = document.querySelector(".panel-employees .panel-content");
    if (!employeesPanel) return;

    employeesPanel.innerHTML = ""; // 기본 "아직 채용된 직원이 없습니다." 문구 제거

    employeeTypes.forEach((type) => {
      const card = document.createElement("div");
      card.className = "employee-card";

      const icon = document.createElement("div");
      icon.className = "employee-card-icon";
      icon.textContent = type.icon;

      const info = document.createElement("div");
      info.className = "employee-card-info";

      const name = document.createElement("div");
      name.className = "employee-card-name";
      const countSpan = document.createElement("span");
      countSpan.className = "employee-card-count";
      countSpan.textContent = "x" + getEmployeeCount(type.id);
      name.textContent = type.name + " ";
      name.appendChild(countSpan);

      const stats = document.createElement("div");
      stats.className = "employee-card-stats";
      stats.textContent =
        "비용 $" + type.cost.toLocaleString() + " · 초당 $" + type.income.toLocaleString();

      const total = document.createElement("div");
      total.className = "employee-card-total";
      total.textContent = "총 수익: $" + (getEmployeeCount(type.id) * type.income).toLocaleString() + "/초";

      const latest = document.createElement("div");
      latest.className = "employee-card-latest";
      latest.style.display = "none";

      const badges = document.createElement("div");
      badges.className = "employee-card-badges";

      info.appendChild(name);
      info.appendChild(stats);
      info.appendChild(total);
      info.appendChild(latest);
      info.appendChild(badges);

      const button = document.createElement("button");
      button.type = "button";
      button.className = "hire-btn";
      button.textContent = "채용";
      button.addEventListener("click", () => hireEmployee(type));

      card.appendChild(icon);
      card.appendChild(info);
      card.appendChild(button);
      employeesPanel.appendChild(card);

      employeeCardRefs[type.id] = { countSpan, button, totalEl: total, latestEl: latest, badgesEl: badges };
    });

    refreshEmployeeCards();
  }

  function refreshEmployeeCards() {
    employeeTypes.forEach((type) => {
      const refs = employeeCardRefs[type.id];
      if (!refs) return;
      const count = getEmployeeCount(type.id);
      refs.countSpan.textContent = "x" + count;
      refs.button.disabled = state.money < type.cost;

      const total =
        getTypeEmployeeIncome(type) *
        getBuildingEmployeeMultiplier() *
        getUpgradeIncomeMultiplier() *
        getResearchMultiplier() *
        getPrestigeMultiplier() *
        getSynergyMultiplier() *
        getBuildingTotalMultiplier();
      refs.totalEl.textContent = "총 수익: $" + Math.floor(total).toLocaleString() + "/초";

      const latest = getLatestHire(type.id);
      if (latest) {
        const info = getPersonalityInfo(latest.personality);
        refs.latestEl.textContent = "최근 채용: " + latest.name + " " + info.icon;
        refs.latestEl.style.display = "";
      } else {
        refs.latestEl.style.display = "none";
      }

      const counts = getPersonalityCounts(type.id);
      refs.badgesEl.innerHTML = personalities
        .filter((p) => counts[p.id] > 0)
        .map((p) => `<span class="personality-badge">${p.icon} ${counts[p.id]}</span>`)
        .join("");
    });
  }

  // =========================================================
  // 팀 시너지 시스템
  // 전체 직원(모든 직종 합산)의 성격 구성으로 실시간 계산되고,
  // 직원 패널 하단에 활성화된 시너지만 표시한다. 구성이 바뀔 때만
  // DOM을 다시 그려서 매 틱(0.2초)마다 재렌더링되며 깜빡이지 않도록 했다.
  // =========================================================
  const synergyDefs = [
    {
      id: "innovation",
      label: "🔥 혁신 시너지",
      bonus: 0.15,
      tooltip: "열정적 1명 + 창의적 1명 이상일 때 전체 수익 +15%",
      isActive: (c) => c.passionate >= 1 && c.creative >= 1,
    },
    {
      id: "quality",
      label: "✅ 품질 보증",
      bonus: 0.10,
      tooltip: "꼼꼼함 3명 이상일 때 전체 수익 +10%",
      isActive: (c) => c.meticulous >= 3,
    },
    {
      id: "burnout",
      label: "💤 번아웃 위험",
      bonus: -0.05,
      tooltip: "느긋함 2명 이상일 때 전체 수익 -5%",
      isActive: (c) => c.lazy >= 2,
    },
  ];

  function getPersonalityTotalCounts() {
    const counts = { passionate: 0, meticulous: 0, creative: 0, lazy: 0 };
    employeeTypes.forEach((type) => {
      getEmployeeList(type.id).forEach((emp) => {
        counts[emp.personality] = (counts[emp.personality] || 0) + 1;
      });
    });
    return counts;
  }

  function getActiveSynergies() {
    const counts = getPersonalityTotalCounts();
    return synergyDefs.filter((s) => s.isActive(counts));
  }

  function getSynergyMultiplier() {
    return 1 + getActiveSynergies().reduce((sum, s) => sum + s.bonus, 0);
  }

  function injectSynergyStyle() {
    const style = document.createElement("style");
    style.textContent = `
      .synergy-section-title {
        margin-top: 16px;
        padding-top: 14px;
        border-top: 1px solid var(--color-border-blue, #d6e4fb);
        font-size: 0.7rem;
        font-weight: 700;
        color: var(--color-text-secondary, #6b7684);
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .synergy-bar {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 8px;
      }
      .synergy-badge {
        font-size: 0.7rem;
        font-weight: 700;
        padding: 5px 10px;
        border-radius: 999px;
        cursor: default;
        white-space: nowrap;
      }
      .synergy-badge.positive {
        background: rgba(22, 163, 74, 0.12);
        color: #15803d;
        border: 1px solid rgba(22, 163, 74, 0.3);
      }
      .synergy-badge.negative {
        background: rgba(220, 38, 38, 0.1);
        color: #b91c1c;
        border: 1px solid rgba(220, 38, 38, 0.25);
      }
      .synergy-empty {
        font-size: 0.68rem;
        color: var(--color-text-secondary, #6b7684);
        margin-top: 8px;
      }
    `;
    document.head.appendChild(style);
  }

  let synergyBarEl = null;
  let lastActiveSynergyIds = null; // null이면 아직 그려진 적 없음 → 최초 1회는 반드시 그림

  function createSynergySection() {
    const panel = document.querySelector(".panel-employees");
    if (!panel) return;

    const title = document.createElement("div");
    title.className = "synergy-section-title";
    title.textContent = "팀 시너지";
    panel.appendChild(title);

    const bar = document.createElement("div");
    bar.className = "synergy-bar";
    panel.appendChild(bar);

    synergyBarEl = bar;
    refreshSynergyBar();
  }

  // 활성화된 시너지 구성이 실제로 바뀔 때만 DOM을 다시 그려서 깜빡임 없이 정적으로 보이게 함
  function refreshSynergyBar() {
    if (!synergyBarEl) return;

    const active = getActiveSynergies();
    const activeIds = active.map((s) => s.id);
    const changed =
      !lastActiveSynergyIds ||
      activeIds.length !== lastActiveSynergyIds.length ||
      activeIds.some((id, i) => id !== lastActiveSynergyIds[i]);

    if (!changed) return;
    lastActiveSynergyIds = activeIds;

    if (active.length === 0) {
      synergyBarEl.innerHTML = `<span class="synergy-empty">활성화된 시너지가 없습니다</span>`;
      return;
    }

    synergyBarEl.innerHTML = active
      .map((s) => {
        const cls = s.bonus >= 0 ? "positive" : "negative";
        const sign = s.bonus >= 0 ? "+" : "";
        return `<span class="synergy-badge ${cls}" title="${s.tooltip}">${s.label} ${sign}${Math.round(s.bonus * 100)}%</span>`;
      })
      .join("");
  }

  // =========================================================
  // 랜덤 이벤트 시스템
  // 직원이 1명 이상일 때만, 30~90초 랜덤 간격으로 화면 중앙 모달을 띄운다.
  // 10초 안에 선택하지 않으면 두 번째 선택지가 자동 실행된다.
  // =========================================================
  const EVENT_DECISION_SECONDS = 10;

  // 랜덤 이벤트로 인한 임시 수익 배율 (만료된 효과는 자동으로 정리)
  function getTemporaryEffectMultiplier() {
    const now = Date.now();
    state.temporaryEffects = state.temporaryEffects.filter((e) => e.endTime > now);
    return state.temporaryEffects.reduce((mult, e) => mult * e.multiplier, 1);
  }

  function addTemporaryEffect(multiplier, seconds) {
    state.temporaryEffects.push({ multiplier, endTime: Date.now() + seconds * 1000 });
  }

  function pickRandomEmployee() {
    const pool = [];
    employeeTypes.forEach((type) => {
      getEmployeeList(type.id).forEach((emp) => pool.push({ type, employee: emp }));
    });
    return pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : null;
  }

  function removeRandomIntern() {
    const list = getEmployeeList("intern");
    if (list.length === 0) return null;
    const idx = Math.floor(Math.random() * list.length);
    return list.splice(idx, 1)[0];
  }

  function buildRandomEvent() {
    const kinds = ["idea", "vc", "scout", "hack", "viral"];
    const kind = kinds[Math.floor(Math.random() * kinds.length)];

    if (kind === "idea") {
      const picked = pickRandomEmployee();
      const name = picked ? picked.employee.name : "직원";
      const icon = picked ? getPersonalityInfo(picked.employee.personality).icon : "💡";
      return {
        icon,
        title: "💡 아이디어 제안",
        message: `${name}: AI 번역 서비스를 만들면 어떨까요?`,
        choiceA: {
          label: "개발한다 ($500)",
          cost: 500,
          onSelect: () => {
            state.money -= 500;
            if (Math.random() < 0.7) earnMoney(2000);
          },
        },
        choiceB: { label: "무시한다", onSelect: () => {} },
      };
    }

    if (kind === "vc") {
      return {
        icon: "💰",
        title: "💰 VC 투자 제안",
        message: "Sequoia에서 투자 제안이 왔습니다!",
        choiceA: {
          label: "수락",
          onSelect: () => {
            earnMoney(state.money * 0.5);
            addTemporaryEffect(0.8, 60);
          },
        },
        choiceB: { label: "거절", onSelect: () => {} },
      };
    }

    if (kind === "scout") {
      const picked = pickRandomEmployee();
      const name = picked ? picked.employee.name : "직원";
      const icon = picked ? getPersonalityInfo(picked.employee.personality).icon : "🕵️";
      const raiseCost = Math.max(1, Math.ceil(state.money * 0.01));
      return {
        icon,
        title: "🕵️ 경쟁사 스카우트",
        message: `${name}를 Future Labs가 스카우트하려 합니다`,
        choiceA: {
          label: "급여 인상 ($" + raiseCost.toLocaleString() + ")",
          cost: raiseCost,
          onSelect: () => {
            state.money -= raiseCost;
            if (picked) picked.employee.raiseBonus = (picked.employee.raiseBonus || 1) * 1.3;
          },
        },
        choiceB: {
          label: "거절",
          onSelect: () => removeRandomIntern(),
        },
      };
    }

    if (kind === "hack") {
      return {
        icon: "⚠️",
        title: "⚠️ 해킹 사고",
        message: "⚠️ 서버가 해킹당했습니다!",
        choiceA: {
          label: "보안 강화 ($1,000)",
          cost: 1000,
          onSelect: () => {
            state.money -= 1000;
          },
        },
        choiceB: {
          label: "방치한다",
          onSelect: () => addTemporaryEffect(0, 30),
        },
      };
    }

    // viral: 선택지 없이 즉시 효과 적용
    return {
      icon: "🔥",
      title: "🔥 바이럴",
      message: "🔥 AI 데모가 바이럴됐습니다!",
      auto: true,
      onTrigger: () => addTemporaryEffect(2, 60),
    };
  }

  let eventModalOpen = false;
  let eventCountdownInterval = null;
  let eventTimeoutHandle = null;
  let eventOverlayEl = null;
  let eventEmojiEl = null;
  let eventTitleEl = null;
  let eventMessageEl = null;
  let eventCountdownEl = null;
  let eventButtonAEl = null;
  let eventButtonBEl = null;

  function injectEventStyle() {
    const style = document.createElement("style");
    style.textContent = `
      .event-overlay {
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(15, 23, 42, 0.55);
        z-index: 1200;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.3s ease;
      }
      .event-overlay.show {
        opacity: 1;
        pointer-events: auto;
      }
      .event-card {
        background: #ffffff;
        border-radius: 16px;
        padding: 28px 32px;
        text-align: center;
        max-width: 340px;
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
        font-family: "Noto Sans KR", sans-serif;
      }
      .event-emoji {
        font-size: 40px;
        margin-bottom: 10px;
      }
      .event-title {
        font-size: 1.05rem;
        font-weight: 800;
        color: #1e293b;
        margin-bottom: 10px;
      }
      .event-message {
        font-size: 0.9rem;
        color: #334155;
        line-height: 1.6;
        margin-bottom: 14px;
      }
      .event-countdown {
        font-size: 0.72rem;
        color: var(--color-text-secondary, #6b7684);
        margin-bottom: 16px;
      }
      .event-buttons {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .event-buttons button {
        border: none;
        padding: 11px;
        font-family: "Noto Sans KR", sans-serif;
        font-size: 0.85rem;
        font-weight: 700;
        border-radius: 8px;
        cursor: pointer;
        transition: filter 0.15s ease, transform 0.08s ease;
      }
      .event-buttons button:active:not(:disabled) {
        transform: scale(0.97);
      }
      .event-btn-a {
        color: #ffffff;
        background: linear-gradient(135deg, #3b82f6, #1d4ed8);
      }
      .event-btn-a:hover:not(:disabled) {
        filter: brightness(1.1);
      }
      .event-btn-a:disabled {
        background: #cbd5e1;
        color: #94a3b8;
        cursor: not-allowed;
      }
      .event-btn-b {
        color: var(--color-text-secondary, #6b7684);
        background: #f1f5f9;
        border: 1px solid var(--color-border-blue, #d6e4fb);
      }
      .event-btn-b:hover {
        background: #e2e8f0;
      }
    `;
    document.head.appendChild(style);
  }

  function createEventModal() {
    const overlay = document.createElement("div");
    overlay.className = "event-overlay";
    overlay.innerHTML = `
      <div class="event-card">
        <div class="event-emoji"></div>
        <div class="event-title"></div>
        <div class="event-message"></div>
        <div class="event-countdown"></div>
        <div class="event-buttons">
          <button type="button" class="event-btn-a"></button>
          <button type="button" class="event-btn-b"></button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    eventOverlayEl = overlay;
    eventEmojiEl = overlay.querySelector(".event-emoji");
    eventTitleEl = overlay.querySelector(".event-title");
    eventMessageEl = overlay.querySelector(".event-message");
    eventCountdownEl = overlay.querySelector(".event-countdown");
    eventButtonAEl = overlay.querySelector(".event-btn-a");
    eventButtonBEl = overlay.querySelector(".event-btn-b");
  }

  function closeEventModal() {
    if (!eventOverlayEl) return;
    eventOverlayEl.classList.remove("show");
    eventModalOpen = false;
  }

  function triggerRandomEvent() {
    const totalEmployees = employeeTypes.reduce((sum, type) => sum + getEmployeeCount(type.id), 0);
    if (totalEmployees === 0 || eventModalOpen || !eventOverlayEl) return;

    eventModalOpen = true;
    const event = buildRandomEvent();

    eventEmojiEl.textContent = event.icon;
    eventTitleEl.textContent = event.title;
    eventMessageEl.textContent = event.message;

    if (event.auto) {
      event.onTrigger();
      eventCountdownEl.textContent = "";
      eventButtonAEl.style.display = "none";
      eventButtonBEl.style.display = "";
      eventButtonBEl.disabled = false;
      eventButtonBEl.textContent = "확인";
      eventButtonBEl.onclick = closeEventModal;

      updateDisplay();
      eventOverlayEl.classList.add("show");
      setTimeout(closeEventModal, 4000);
      return;
    }

    eventButtonAEl.style.display = "";
    eventButtonBEl.style.display = "";
    eventButtonAEl.textContent = event.choiceA.label;
    eventButtonBEl.textContent = event.choiceB.label;
    eventButtonAEl.disabled = event.choiceA.cost != null && state.money < event.choiceA.cost;

    const resolve = (onSelect) => {
      clearTimeout(eventTimeoutHandle);
      clearInterval(eventCountdownInterval);
      onSelect();
      updateDisplay();
      refreshEmployeeCards();
      refreshUpgradeStore();
      refreshSynergyBar();
      closeEventModal();
    };

    eventButtonAEl.onclick = () => resolve(event.choiceA.onSelect);
    eventButtonBEl.onclick = () => resolve(event.choiceB.onSelect);

    let remaining = EVENT_DECISION_SECONDS;
    eventCountdownEl.textContent = remaining + '초 후 자동으로 "' + event.choiceB.label + '" 처리됩니다';
    eventCountdownInterval = setInterval(() => {
      remaining -= 1;
      eventCountdownEl.textContent = remaining + '초 후 자동으로 "' + event.choiceB.label + '" 처리됩니다';
    }, 1000);
    eventTimeoutHandle = setTimeout(() => resolve(event.choiceB.onSelect), EVENT_DECISION_SECONDS * 1000);

    eventOverlayEl.classList.add("show");
  }

  function scheduleNextRandomEvent() {
    const delay = (30 + Math.random() * 60) * 1000; // 30~90초 랜덤 간격
    setTimeout(() => {
      triggerRandomEvent();
      scheduleNextRandomEvent();
    }, delay);
  }

  // =========================================================
  // 회사 성장 시스템
  // =========================================================
  const levels = [
    { level: 1, min: 0, emoji: "🏚️", name: "차고 스타트업" },
    { level: 2, min: 1000, emoji: "🌱", name: "시드 단계" },
    { level: 3, min: 10000, emoji: "🚀", name: "시리즈 A" },
    { level: 4, min: 100000, emoji: "🦄", name: "유니콘" },
    { level: 5, min: 1000000, emoji: "🌍", name: "글로벌 AI 기업" },
    { level: 6, min: 50000000, emoji: "🌌", name: "AI 제국" },
  ];

  function getLevelForMoney(money) {
    for (let i = levels.length - 1; i >= 0; i--) {
      if (money >= levels[i].min) return levels[i];
    }
    return levels[0];
  }

  // 회사 정보 패널의 "현재 레벨" 표시 요소
  // (index.html을 직접 수정하지 않기 위해 기존 .info-row와 동일한 구조로 만들어 추가)
  let levelNameEl = null;

  function createLevelNameRow() {
    const panelContent = document.querySelector(".panel-company-info .panel-content");
    if (!panelContent) return;

    const row = document.createElement("div");
    row.className = "info-row";
    row.innerHTML = `
      <span class="info-label">현재 레벨</span>
      <span class="info-value"></span>
    `;
    panelContent.appendChild(row);
    levelNameEl = row.querySelector(".info-value");
  }

  // 자금 기준으로 레벨/회사가치/명성을 재계산 (updateDisplay에서 매번 호출됨)
  function updateGrowth() {
    const levelInfo = getLevelForMoney(state.money);
    const isLevelUp = levelInfo.level > state.level;
    state.level = levelInfo.level;
    if (isLevelUp) showLevelUpPopup(levelInfo);

    state.companyValue = state.money * state.level * 1.5;

    const totalEmployees = employeeTypes.reduce(
      (sum, type) => sum + getEmployeeCount(type.id),
      0
    );
    state.reputation = totalEmployees * 10;

    if (levelNameEl) levelNameEl.textContent = levelInfo.emoji + " " + levelInfo.name;
    updateOfficeBackground();
  }

  function injectLevelUpOverlayStyle() {
    const style = document.createElement("style");
    style.textContent = `
      .levelup-overlay {
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(15, 23, 42, 0.45);
        z-index: 1000;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.3s ease;
      }
      .levelup-overlay.show {
        opacity: 1;
      }
      .levelup-card {
        background: linear-gradient(135deg, #fde047, #f59e0b);
        border-radius: 16px;
        padding: 32px 40px;
        text-align: center;
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
        font-family: "Noto Sans KR", sans-serif;
      }
      .levelup-emoji {
        font-size: 44px;
        margin-bottom: 10px;
      }
      .levelup-message {
        font-size: 1.15rem;
        font-weight: 800;
        color: #451a03;
      }
    `;
    document.head.appendChild(style);
  }

  function showLevelUpPopup(levelInfo) {
    const overlay = document.createElement("div");
    overlay.className = "levelup-overlay";
    overlay.innerHTML = `
      <div class="levelup-card">
        <div class="levelup-emoji">🎉</div>
        <div class="levelup-message">레벨업! ${levelInfo.name} 달성!</div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("show"));

    setTimeout(() => {
      overlay.classList.remove("show");
      setTimeout(() => {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }, 300);
    }, 3000);
  }

  // =========================================================
  // 업그레이드 상점
  // 회사 정보 패널 아래 "🔧 업그레이드" 섹션 (index.html에 컨테이너만 추가하고
  // 카드 내용/스타일은 game.js에서 생성)
  //
  // 참고: 이 프로젝트에는 아직 마일스톤 시스템이 없어서
  // "마일스톤 가속기"는 구매(비용 차감·체크 표시)까지만 동작하고
  // 실제 효과는 마일스톤 시스템이 추가된 뒤에 연결해야 합니다.
  // "연구 가속기"는 아래 연구소 섹션의 getResearchDuration()에 연결되어 있습니다.
  // =========================================================
  const upgradeTypes = [
    { id: "click_boost_1", category: "클릭 강화", name: "아이디어 부스트 I", icon: "💡", desc: "클릭당 +$5", cost: 500 },
    { id: "click_boost_2", category: "클릭 강화", name: "아이디어 부스트 II", icon: "💡", desc: "클릭당 +$20", cost: 5000 },
    { id: "auto_clicker", category: "클릭 강화", name: "자동 클릭봇", icon: "🤖", desc: "초당 자동 클릭 1회", cost: 50000 },
    { id: "office_expand", category: "전체 수익 배율", name: "사무실 확장", icon: "🏢", desc: "전체 수익 x1.5", cost: 10000, incomeMult: 1.5 },
    { id: "ai_server", category: "전체 수익 배율", name: "AI 서버 증설", icon: "💻", desc: "전체 수익 x2", cost: 100000, incomeMult: 2 },
    { id: "global_dc", category: "전체 수익 배율", name: "글로벌 데이터센터", icon: "🌐", desc: "전체 수익 x5", cost: 1000000, incomeMult: 5 },
    { id: "offline_extend", category: "특수", name: "오프라인 연장", icon: "⏰", desc: "오프라인 한도 8h → 24h", cost: 500000 },
    { id: "milestone_accel", category: "특수", name: "마일스톤 가속기", icon: "🎯", desc: "마일스톤 보너스 2배", cost: 5000000 },
    { id: "research_accel", category: "특수", name: "연구 가속기", icon: "🔬", desc: "연구 시간 50% 단축", cost: 10000000 },
  ];

  function hasUpgrade(id) {
    return state.purchasedUpgrades.includes(id);
  }

  function getUpgradeIncomeMultiplier() {
    return upgradeTypes
      .filter((u) => u.incomeMult && hasUpgrade(u.id))
      .reduce((mult, u) => mult * u.incomeMult, 1);
  }

  function getClickValue() {
    let value = 1;
    if (hasUpgrade("click_boost_1")) value += 5;
    if (hasUpgrade("click_boost_2")) value += 20;
    return value;
  }

  function getMaxOfflineSeconds() {
    return hasUpgrade("offline_extend") ? 24 * 60 * 60 : 8 * 60 * 60;
  }

  function purchaseUpgrade(type) {
    if (hasUpgrade(type.id) || state.money < type.cost) return;
    state.money -= type.cost;
    state.purchasedUpgrades.push(type.id);
    updateDisplay();
    refreshEmployeeCards();
    refreshUpgradeStore();
    refreshClickButtonLabel();
  }

  const upgradeCardRefs = {};

  function injectUpgradeStoreStyle() {
    const style = document.createElement("style");
    style.textContent = `
      .upgrade-section-title {
        margin-top: 24px;
        padding-top: 20px;
        border-top: 1px solid var(--color-border-blue, #d6e4fb);
      }
      .upgrade-category {
        font-size: 0.7rem;
        font-weight: 700;
        color: var(--color-text-secondary, #6b7684);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        margin: 14px 0 8px;
      }
      .upgrade-category:first-child {
        margin-top: 0;
      }
      .upgrade-card {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px;
        margin-bottom: 8px;
        background: var(--color-surface, #ffffff);
        border: 1px solid var(--color-border-blue, #d6e4fb);
        border-radius: 10px;
      }
      .upgrade-card:last-child {
        margin-bottom: 0;
      }
      .upgrade-card-icon {
        flex-shrink: 0;
        font-size: 1.2rem;
      }
      .upgrade-card-info {
        flex: 1;
        min-width: 0;
      }
      .upgrade-card-name {
        font-size: 0.78rem;
        font-weight: 700;
        color: var(--color-text, #1e293b);
      }
      .upgrade-card-desc {
        font-size: 0.68rem;
        color: var(--color-text-secondary, #6b7684);
        margin-top: 2px;
      }
      .upgrade-card-action {
        flex-shrink: 0;
      }
      .buy-btn {
        border: none;
        padding: 6px 10px;
        font-family: "Noto Sans KR", sans-serif;
        font-size: 0.7rem;
        font-weight: 700;
        color: #ffffff;
        background: linear-gradient(135deg, #3b82f6, #1d4ed8);
        border-radius: 8px;
        cursor: pointer;
        white-space: nowrap;
        transition: filter 0.15s ease, transform 0.08s ease;
      }
      .buy-btn:hover:not(:disabled) {
        filter: brightness(1.1);
      }
      .buy-btn:active:not(:disabled) {
        transform: scale(0.94);
      }
      .buy-btn:disabled {
        background: #cbd5e1;
        color: #94a3b8;
        cursor: not-allowed;
      }
      .upgrade-purchased {
        font-size: 0.9rem;
        font-weight: 800;
        color: #16a34a;
        white-space: nowrap;
      }
    `;
    document.head.appendChild(style);
  }

  function createUpgradeStore() {
    const container = document.querySelector(".panel-company-info .upgrade-list");
    if (!container) return;

    const categories = [...new Set(upgradeTypes.map((u) => u.category))];

    categories.forEach((category) => {
      const categoryTitle = document.createElement("div");
      categoryTitle.className = "upgrade-category";
      categoryTitle.textContent = category;
      container.appendChild(categoryTitle);

      upgradeTypes
        .filter((u) => u.category === category)
        .forEach((type) => {
          const card = document.createElement("div");
          card.className = "upgrade-card";

          const icon = document.createElement("div");
          icon.className = "upgrade-card-icon";
          icon.textContent = type.icon;

          const info = document.createElement("div");
          info.className = "upgrade-card-info";
          info.innerHTML = `
            <div class="upgrade-card-name">${type.name}</div>
            <div class="upgrade-card-desc">${type.desc} · $${type.cost.toLocaleString()}</div>
          `;

          const action = document.createElement("div");
          action.className = "upgrade-card-action";

          const button = document.createElement("button");
          button.type = "button";
          button.className = "buy-btn";
          button.textContent = "구매";
          button.addEventListener("click", () => purchaseUpgrade(type));

          const purchasedBadge = document.createElement("span");
          purchasedBadge.className = "upgrade-purchased";
          purchasedBadge.textContent = "✅";
          purchasedBadge.style.display = "none";

          action.appendChild(button);
          action.appendChild(purchasedBadge);

          card.appendChild(icon);
          card.appendChild(info);
          card.appendChild(action);
          container.appendChild(card);

          upgradeCardRefs[type.id] = { button, purchasedBadge, type };
        });
    });

    refreshUpgradeStore();
  }

  function refreshUpgradeStore() {
    Object.values(upgradeCardRefs).forEach((refs) => {
      const purchased = hasUpgrade(refs.type.id);
      refs.button.style.display = purchased ? "none" : "";
      refs.purchasedBadge.style.display = purchased ? "" : "none";
      if (!purchased) refs.button.disabled = state.money < refs.type.cost;
    });
  }

  // =========================================================
  // AI 연구 트리
  // 회사 정보 패널 아래 "🔬 연구소" 섹션 (index.html에 컨테이너만 추가하고
  // 카드 내용/스타일은 game.js에서 생성). 6단계는 순서대로만 해금되고
  // 동시에 1개만 연구할 수 있다.
  // =========================================================
  const researchTree = [
    { id: "gpt2", name: "GPT-2", cost: 5000, duration: 10, mult: 1.5 },
    { id: "gpt3", name: "GPT-3", cost: 50000, duration: 20, mult: 2 },
    { id: "gpt4", name: "GPT-4", cost: 500000, duration: 40, mult: 3 },
    { id: "gpt5", name: "GPT-5", cost: 5000000, duration: 60, mult: 5 },
    { id: "agi", name: "AGI", cost: 50000000, duration: 90, mult: 10 },
    { id: "asi", name: "ASI", cost: 500000000, duration: 120, mult: 50 },
  ];

  function getResearchMultiplier() {
    return researchTree
      .filter((r) => state.completedResearch.includes(r.id))
      .reduce((mult, r) => mult * r.mult, 1);
  }

  // "연구 가속기" 업그레이드(-50%)와 "연구동" 건물(-30%)은 곱연산으로 함께 적용 (새로 시작하는 연구부터)
  function getResearchDuration(research) {
    let duration = research.duration;
    if (hasUpgrade("research_accel")) duration *= 0.5;
    duration *= getBuildingResearchSpeedMultiplier();
    return duration;
  }

  function isResearchAvailable(research) {
    if (state.completedResearch.includes(research.id)) return false;
    const idx = researchTree.indexOf(research);
    for (let i = 0; i < idx; i++) {
      if (!state.completedResearch.includes(researchTree[i].id)) return false;
    }
    return true;
  }

  function formatDuration(totalSeconds) {
    const s = Math.max(0, Math.ceil(totalSeconds));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? m + "분 " + sec + "초" : sec + "초";
  }

  function startResearch(research) {
    if (state.activeResearch) return; // 동시에 1개만 연구 가능
    if (!isResearchAvailable(research)) return;
    if (state.money < research.cost) return;

    state.money -= research.cost;
    const duration = getResearchDuration(research);
    state.activeResearch = {
      id: research.id,
      startTime: Date.now(),
      endTime: Date.now() + duration * 1000,
      duration, // 진행률 계산 기준 (연구 가속기를 나중에 구매해도 이 값은 그대로 유지)
    };

    updateDisplay();
    refreshUpgradeStore();
    refreshResearchSection();
  }

  function checkResearchCompletion() {
    if (!state.activeResearch) return;
    if (Date.now() < state.activeResearch.endTime) return;

    const research = researchTree.find((r) => r.id === state.activeResearch.id);
    state.completedResearch.push(research.id);
    state.activeResearch = null;

    showResearchCompletePopup(research);
    updateDisplay();
    refreshResearchSection();
  }

  function injectResearchStyle() {
    const style = document.createElement("style");
    style.textContent = `
      .research-section-title {
        margin-top: 24px;
        padding-top: 20px;
        border-top: 1px solid var(--color-border-blue, #d6e4fb);
      }
      .research-card {
        background: var(--color-surface, #ffffff);
        border: 1px solid var(--color-border-blue, #d6e4fb);
        border-radius: 10px;
        padding: 12px;
        margin-bottom: 10px;
      }
      .research-card:last-child {
        margin-bottom: 0;
      }
      .research-card-name {
        font-size: 0.85rem;
        font-weight: 700;
        color: var(--color-text, #1e293b);
      }
      .research-card-desc {
        font-size: 0.7rem;
        color: var(--color-text-secondary, #6b7684);
        margin-top: 2px;
      }
      .research-card-action {
        margin-top: 8px;
      }
      .research-btn {
        width: 100%;
        border: none;
        padding: 8px;
        font-family: "Noto Sans KR", sans-serif;
        font-size: 0.75rem;
        font-weight: 700;
        color: #ffffff;
        background: linear-gradient(135deg, #8b5cf6, #6d28d9);
        border-radius: 8px;
        cursor: pointer;
        transition: filter 0.15s ease, transform 0.08s ease;
      }
      .research-btn:hover:not(:disabled) {
        filter: brightness(1.1);
      }
      .research-btn:active:not(:disabled) {
        transform: scale(0.97);
      }
      .research-btn:disabled {
        background: #cbd5e1;
        color: #94a3b8;
        cursor: not-allowed;
      }
      .research-status-label {
        display: block;
        text-align: center;
        font-size: 0.72rem;
        color: var(--color-text-secondary, #6b7684);
        padding: 6px 0;
      }
      .research-completed {
        display: block;
        text-align: center;
        font-size: 0.85rem;
        font-weight: 800;
        color: #16a34a;
        padding: 4px 0;
      }
      .research-progress-wrap {
        margin-top: 8px;
      }
      .research-progress-track {
        width: 100%;
        height: 6px;
        border-radius: 999px;
        background: #e2e8f0;
        overflow: hidden;
      }
      .research-progress-fill {
        height: 100%;
        width: 0%;
        background: linear-gradient(90deg, #8b5cf6, #3b82f6);
        transition: width 0.2s linear;
      }
      .research-countdown {
        margin-top: 4px;
        font-size: 0.7rem;
        color: var(--color-text-secondary, #6b7684);
        text-align: center;
      }
      .research-complete-overlay {
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(15, 23, 42, 0.5);
        z-index: 1000;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.3s ease;
      }
      .research-complete-overlay.show {
        opacity: 1;
      }
      .research-complete-card {
        background: linear-gradient(135deg, #8b5cf6, #3b82f6);
        border-radius: 16px;
        padding: 32px 40px;
        text-align: center;
        max-width: 320px;
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
        font-family: "Noto Sans KR", sans-serif;
      }
      .research-complete-emoji {
        font-size: 44px;
        margin-bottom: 10px;
      }
      .research-complete-message {
        font-size: 1.05rem;
        font-weight: 800;
        color: #ffffff;
      }
    `;
    document.head.appendChild(style);
  }

  function showResearchCompletePopup(research) {
    const overlay = document.createElement("div");
    overlay.className = "research-complete-overlay";
    overlay.innerHTML = `
      <div class="research-complete-card">
        <div class="research-complete-emoji">✨</div>
        <div class="research-complete-message">${research.name} 연구 완료! 전체 수익 ${research.mult}배!</div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("show"));

    setTimeout(() => {
      overlay.classList.remove("show");
      setTimeout(() => {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }, 300);
    }, 3200);
  }

  const researchCardRefs = {};

  function createResearchSection() {
    const container = document.querySelector(".panel-company-info .research-list");
    if (!container) return;

    researchTree.forEach((research) => {
      const card = document.createElement("div");
      card.className = "research-card";

      const info = document.createElement("div");
      info.className = "research-card-info";
      info.innerHTML = `
        <div class="research-card-name">${research.name}</div>
        <div class="research-card-desc">전체 수익 x${research.mult} · $${research.cost.toLocaleString()} · ${formatDuration(research.duration)}</div>
      `;

      const action = document.createElement("div");
      action.className = "research-card-action";

      const button = document.createElement("button");
      button.type = "button";
      button.className = "research-btn";
      button.textContent = "연구 시작";
      button.addEventListener("click", () => startResearch(research));

      const lockedLabel = document.createElement("span");
      lockedLabel.className = "research-status-label";
      lockedLabel.style.display = "none";

      const completedLabel = document.createElement("span");
      completedLabel.className = "research-completed";
      completedLabel.textContent = "✅ 완료";
      completedLabel.style.display = "none";

      action.appendChild(button);
      action.appendChild(lockedLabel);
      action.appendChild(completedLabel);

      const progressWrap = document.createElement("div");
      progressWrap.className = "research-progress-wrap";
      progressWrap.style.display = "none";
      progressWrap.innerHTML = `
        <div class="research-progress-track"><div class="research-progress-fill"></div></div>
        <div class="research-countdown"></div>
      `;

      card.appendChild(info);
      card.appendChild(action);
      card.appendChild(progressWrap);
      container.appendChild(card);

      researchCardRefs[research.id] = {
        button,
        lockedLabel,
        completedLabel,
        progressWrap,
        progressFill: progressWrap.querySelector(".research-progress-fill"),
        countdownEl: progressWrap.querySelector(".research-countdown"),
      };
    });

    refreshResearchSection();
  }

  function refreshResearchSection() {
    researchTree.forEach((research) => {
      const refs = researchCardRefs[research.id];
      if (!refs) return;

      const completed = state.completedResearch.includes(research.id);
      const isActive = state.activeResearch && state.activeResearch.id === research.id;
      const available =
        !completed && !isActive && !state.activeResearch && isResearchAvailable(research);

      refs.button.style.display = "none";
      refs.lockedLabel.style.display = "none";
      refs.completedLabel.style.display = "none";
      refs.progressWrap.style.display = "none";

      if (completed) {
        refs.completedLabel.style.display = "";
      } else if (isActive) {
        refs.progressWrap.style.display = "";
        const remainingMs = state.activeResearch.endTime - Date.now();
        const totalMs = state.activeResearch.duration * 1000;
        const pct = Math.min(100, Math.max(0, ((totalMs - remainingMs) / totalMs) * 100));
        refs.progressFill.style.width = pct + "%";
        refs.countdownEl.textContent = formatDuration(remainingMs / 1000) + " 남음";
      } else if (available) {
        refs.button.style.display = "";
        refs.button.disabled = state.money < research.cost;
      } else if (!isResearchAvailable(research)) {
        refs.lockedLabel.style.display = "";
        refs.lockedLabel.textContent = "🔒 이전 연구 필요";
      } else {
        refs.lockedLabel.style.display = "";
        refs.lockedLabel.textContent = "⏳ 다른 연구 진행 중";
      }
    });
  }

  // =========================================================
  // 프로젝트 시스템
  // 오른쪽 프로젝트 패널(.panel-projects .panel-content)에 렌더링.
  // 연구와 달리 순서 제한 없이 아무 프로젝트나 시작할 수 있고,
  // 완료되면 목록에서 완전히 제거된다.
  // =========================================================
  const projectTypes = [
    { id: "chatbot", name: "AI 챗봇", cost: 500, duration: 8, reward: 2000, incomeBonus: 10 },
    { id: "translator", name: "AI 번역기", cost: 2000, duration: 15, reward: 8000, incomeBonus: 30 },
    { id: "image_gen", name: "AI 이미지 생성기", cost: 10000, duration: 25, reward: 40000, incomeBonus: 100 },
    { id: "speech", name: "AI 음성인식", cost: 50000, duration: 40, reward: 200000, incomeBonus: 500 },
    { id: "self_driving", name: "AI 자율주행", cost: 500000, duration: 60, reward: 2000000, incomeBonus: 2000 },
    { id: "medical", name: "AI 의료진단", cost: 5000000, duration: 80, reward: 20000000, incomeBonus: 10000 },
    { id: "robot", name: "AI 로봇", cost: 50000000, duration: 100, reward: 200000000, incomeBonus: 50000 },
    { id: "agi_platform", name: "AGI 플랫폼", cost: 500000000, duration: 120, reward: 2000000000, incomeBonus: 200000 },
  ];

  function getProjectIncomeBonus() {
    return projectTypes
      .filter((p) => state.completedProjects.includes(p.id))
      .reduce((sum, p) => sum + p.incomeBonus, 0);
  }

  function startProject(project) {
    if (state.activeProject) return; // 동시에 1개만 진행 가능
    if (state.completedProjects.includes(project.id)) return;
    if (state.money < project.cost) return;

    state.money -= project.cost;
    state.activeProject = {
      id: project.id,
      startTime: Date.now(),
      endTime: Date.now() + project.duration * 1000,
      duration: project.duration,
    };

    updateDisplay();
    refreshUpgradeStore();
    renderProjectList();
  }

  function checkProjectCompletion() {
    if (!state.activeProject) return;
    if (Date.now() < state.activeProject.endTime) return;

    const project = projectTypes.find((p) => p.id === state.activeProject.id);
    state.completedProjects.push(project.id);
    state.activeProject = null;

    earnMoney(project.reward);
    showProjectCompletePopup(project);
    renderProjectList();
  }

  function injectProjectStyle() {
    const style = document.createElement("style");
    style.textContent = `
      .project-card {
        background: var(--color-surface, #ffffff);
        border: 1px solid var(--color-border-blue, #d6e4fb);
        border-radius: 10px;
        padding: 12px;
        margin-bottom: 10px;
      }
      .project-card:last-child {
        margin-bottom: 0;
      }
      .project-card-name {
        font-size: 0.85rem;
        font-weight: 700;
        color: var(--color-text, #1e293b);
      }
      .project-card-desc {
        font-size: 0.68rem;
        color: var(--color-text-secondary, #6b7684);
        margin-top: 2px;
        line-height: 1.5;
      }
      .project-card-action {
        margin-top: 8px;
      }
      .project-btn {
        width: 100%;
        border: none;
        padding: 8px;
        font-family: "Noto Sans KR", sans-serif;
        font-size: 0.75rem;
        font-weight: 700;
        color: #ffffff;
        background: linear-gradient(135deg, #f97316, #ea580c);
        border-radius: 8px;
        cursor: pointer;
        transition: filter 0.15s ease, transform 0.08s ease;
      }
      .project-btn:hover:not(:disabled) {
        filter: brightness(1.1);
      }
      .project-btn:active:not(:disabled) {
        transform: scale(0.97);
      }
      .project-btn:disabled {
        background: #cbd5e1;
        color: #94a3b8;
        cursor: not-allowed;
      }
      .project-progress-track {
        width: 100%;
        height: 6px;
        border-radius: 999px;
        background: #e2e8f0;
        overflow: hidden;
      }
      .project-progress-fill {
        height: 100%;
        background: linear-gradient(90deg, #f97316, #ea580c);
        transition: width 0.2s linear;
      }
      .project-countdown {
        margin-top: 4px;
        font-size: 0.7rem;
        color: var(--color-text-secondary, #6b7684);
        text-align: center;
      }
      .project-complete-overlay {
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(15, 23, 42, 0.5);
        z-index: 1000;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.3s ease;
      }
      .project-complete-overlay.show {
        opacity: 1;
      }
      .project-complete-card {
        background: linear-gradient(135deg, #f97316, #ea580c);
        border-radius: 16px;
        padding: 32px 40px;
        text-align: center;
        max-width: 320px;
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
        font-family: "Noto Sans KR", sans-serif;
      }
      .project-complete-emoji {
        font-size: 44px;
        margin-bottom: 10px;
      }
      .project-complete-message {
        font-size: 1.05rem;
        font-weight: 800;
        color: #ffffff;
      }
    `;
    document.head.appendChild(style);
  }

  function showProjectCompletePopup(project) {
    const overlay = document.createElement("div");
    overlay.className = "project-complete-overlay";
    overlay.innerHTML = `
      <div class="project-complete-card">
        <div class="project-complete-emoji">🚀</div>
        <div class="project-complete-message">${project.name} 출시 완료! $${formatNumber(project.reward)} 획득!</div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("show"));

    setTimeout(() => {
      overlay.classList.remove("show");
      setTimeout(() => {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }, 300);
    }, 3200);
  }

  // 완료된 프로젝트는 목록에서 제거되어야 해서(연구와 달리 카드가 사라짐),
  // 매번 목록 전체를 다시 그리는 방식으로 구현
  function renderProjectList() {
    const container = document.querySelector(".panel-projects .panel-content");
    if (!container) return;

    const visibleProjects = projectTypes.filter(
      (p) => !state.completedProjects.includes(p.id)
    );

    if (visibleProjects.length === 0) {
      container.innerHTML = `<p class="empty-state">🎉 모든 프로젝트를 완료했습니다!</p>`;
      return;
    }

    container.innerHTML = "";

    visibleProjects.forEach((project) => {
      const isActive = state.activeProject && state.activeProject.id === project.id;

      const card = document.createElement("div");
      card.className = "project-card";

      const info = document.createElement("div");
      info.className = "project-card-info";
      info.innerHTML = `
        <div class="project-card-name">${project.name}</div>
        <div class="project-card-desc">$${project.cost.toLocaleString()} · ${formatDuration(project.duration)} · 완료 시 $${project.reward.toLocaleString()} + $${project.incomeBonus.toLocaleString()}/초</div>
      `;

      const action = document.createElement("div");
      action.className = "project-card-action";

      if (isActive) {
        const remainingMs = state.activeProject.endTime - Date.now();
        const totalMs = state.activeProject.duration * 1000;
        const pct = Math.min(100, Math.max(0, ((totalMs - remainingMs) / totalMs) * 100));
        action.innerHTML = `
          <div class="project-progress-track"><div class="project-progress-fill" style="width:${pct}%"></div></div>
          <div class="project-countdown">${formatDuration(remainingMs / 1000)} 남음</div>
        `;
      } else {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "project-btn";
        button.textContent = "시작";
        button.disabled = !!state.activeProject || state.money < project.cost;
        button.addEventListener("click", () => startProject(project));
        action.appendChild(button);
      }

      card.appendChild(info);
      card.appendChild(action);
      container.appendChild(card);
    });
  }

  // =========================================================
  // 프레스티지 시스템 ("회사 매각")
  // 왼쪽 회사 정보 패널 맨 아래에 버튼 + 확인 팝업을 추가.
  // 매각 후에도 업그레이드 중 "특수" 카테고리(오프라인 연장/마일스톤 가속기/
  // 연구 가속기)만 영구 유지되도록 했다 (스펙의 "업그레이드 일부"를 이렇게 해석).
  // =========================================================
  const PRESTIGE_THRESHOLD = 10000000;
  const prestigeTitles = ["🌱 AI 스타트업", "💼 시리얼 창업가", "🏆 AI 레전드", "🌟 AI 신화"];
  const PRESTIGE_KEEP_CATEGORIES = ["특수"];

  function getPrestigeTitle() {
    return prestigeTitles[Math.min(state.prestigeCount, prestigeTitles.length - 1)];
  }

  function getPrestigeFameGain() {
    return Math.floor(Math.sqrt(state.lifetimeEarnings) / 1000);
  }

  function canPrestige() {
    return state.lifetimeEarnings >= PRESTIGE_THRESHOLD;
  }

  function getPrestigeMultiplier() {
    return 1 + state.prestigePoints * 0.02;
  }

  let prestigeStatEl = null;

  // 상단바에 "AI 명성" 통계 카드를 추가 (기존 .stat-item과 동일한 구조로 만들어
  // index.html을 직접 수정하지 않고도 스타일이 그대로 적용되도록 함)
  function createPrestigeStat() {
    const headerStats = document.querySelector(".header-stats");
    if (!headerStats) return;

    const item = document.createElement("div");
    item.className = "stat-item";
    item.innerHTML = `
      <span class="stat-icon">✨</span>
      <div class="stat-text">
        <span class="stat-label">${getPrestigeTitle()}</span>
        <span class="stat-value">0pt (+0%)</span>
      </div>
    `;
    headerStats.appendChild(item);
    prestigeStatEl = item.querySelector(".stat-value");
  }

  function refreshPrestigeStat() {
    if (!prestigeStatEl) return;
    const bonusPercent = Math.round(state.prestigePoints * 2);
    prestigeStatEl.textContent = state.prestigePoints + "pt (+" + bonusPercent + "%)";
    const labelEl = prestigeStatEl.parentElement.querySelector(".stat-label");
    if (labelEl) labelEl.textContent = getPrestigeTitle();
  }

  let prestigeButtonEl = null;
  let prestigeHintEl = null;

  function injectPrestigeStyle() {
    const style = document.createElement("style");
    style.textContent = `
      .prestige-section-title {
        margin-top: 24px;
        padding-top: 20px;
        border-top: 1px solid var(--color-border-blue, #d6e4fb);
      }
      .prestige-btn {
        width: 100%;
        border: none;
        padding: 12px;
        font-family: "Noto Sans KR", sans-serif;
        font-size: 0.85rem;
        font-weight: 700;
        color: #ffffff;
        background: linear-gradient(135deg, #ec4899, #be185d);
        border-radius: 10px;
        cursor: pointer;
        transition: filter 0.15s ease, transform 0.08s ease;
      }
      .prestige-btn:hover:not(:disabled) {
        filter: brightness(1.1);
      }
      .prestige-btn:active:not(:disabled) {
        transform: scale(0.97);
      }
      .prestige-btn:disabled {
        background: #cbd5e1;
        color: #94a3b8;
        cursor: not-allowed;
      }
      .prestige-hint {
        margin-top: 8px;
        text-align: center;
        font-size: 0.7rem;
        color: var(--color-text-secondary, #6b7684);
      }
      .prestige-overlay {
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(15, 23, 42, 0.55);
        z-index: 1100;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.3s ease;
      }
      .prestige-overlay.show {
        opacity: 1;
        pointer-events: auto;
      }
      .prestige-card {
        background: #ffffff;
        border-radius: 16px;
        padding: 28px 32px;
        text-align: center;
        max-width: 340px;
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
        font-family: "Noto Sans KR", sans-serif;
      }
      .prestige-emoji {
        font-size: 40px;
        margin-bottom: 10px;
      }
      .prestige-details {
        font-size: 0.9rem;
        color: #1e293b;
        line-height: 1.7;
        margin-bottom: 14px;
      }
      .prestige-formula {
        font-size: 0.72rem;
        color: var(--color-text-secondary, #6b7684);
      }
      .prestige-warning {
        font-size: 0.78rem;
        color: #be123c;
        line-height: 1.6;
        background: rgba(244, 63, 94, 0.08);
        border: 1px solid rgba(244, 63, 94, 0.25);
        border-radius: 10px;
        padding: 10px;
        margin-bottom: 18px;
      }
      .prestige-buttons {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .prestige-confirm-btn {
        border: none;
        padding: 11px;
        font-family: "Noto Sans KR", sans-serif;
        font-size: 0.85rem;
        font-weight: 700;
        color: #ffffff;
        background: linear-gradient(135deg, #ec4899, #be185d);
        border-radius: 8px;
        cursor: pointer;
        transition: filter 0.15s ease;
      }
      .prestige-confirm-btn:hover {
        filter: brightness(1.1);
      }
      .prestige-cancel-btn {
        border: 1px solid var(--color-border-blue, #d6e4fb);
        padding: 11px;
        font-family: "Noto Sans KR", sans-serif;
        font-size: 0.85rem;
        font-weight: 700;
        color: var(--color-text-secondary, #6b7684);
        background: #ffffff;
        border-radius: 8px;
        cursor: pointer;
        transition: background-color 0.15s ease;
      }
      .prestige-cancel-btn:hover {
        background: #f1f5f9;
      }
    `;
    document.head.appendChild(style);
  }

  function createPrestigeSection() {
    const panel = document.querySelector(".panel-company-info");
    if (!panel) return;

    const title = document.createElement("h2");
    title.className = "panel-title prestige-section-title";
    title.textContent = "💼 회사 매각";
    panel.appendChild(title);

    const wrap = document.createElement("div");
    wrap.className = "panel-content";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "prestige-btn";
    button.textContent = "💼 회사 매각";
    button.disabled = true;
    button.addEventListener("click", openPrestigeConfirm);

    const hint = document.createElement("div");
    hint.className = "prestige-hint";

    wrap.appendChild(button);
    wrap.appendChild(hint);
    panel.appendChild(wrap);

    prestigeButtonEl = button;
    prestigeHintEl = hint;
  }

  function refreshPrestigeButton() {
    if (!prestigeButtonEl) return;
    const unlocked = canPrestige();
    prestigeButtonEl.disabled = !unlocked;
    prestigeHintEl.textContent = unlocked
      ? "회사를 매각하고 AI 명성을 얻을 수 있습니다"
      : "누적 수익 $" + formatNumber(state.lifetimeEarnings) + " / $" + formatNumber(PRESTIGE_THRESHOLD) + " 필요";
  }

  function openPrestigeConfirm() {
    if (!canPrestige()) return;
    const fameGain = getPrestigeFameGain();

    const overlay = document.createElement("div");
    overlay.className = "prestige-overlay";
    overlay.innerHTML = `
      <div class="prestige-card">
        <div class="prestige-emoji">💼</div>
        <div class="prestige-details">
          현재 회사 가치: <b>$${formatNumber(state.companyValue)}</b><br>
          획득할 AI 명성: <b>+${fameGain} 포인트</b><br>
          <span class="prestige-formula">(명성 = 누적수익 제곱근 ÷ 1,000)</span>
        </div>
        <div class="prestige-warning">
          ⚠️ 자금, 직원, 연구, 프로젝트가 초기화됩니다.<br>
          AI 명성과 업그레이드 일부는 영구 유지됩니다.
        </div>
        <div class="prestige-buttons">
          <button type="button" class="prestige-confirm-btn">매각한다</button>
          <button type="button" class="prestige-cancel-btn">취소</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("show"));

    function closeOverlay() {
      overlay.classList.remove("show");
      setTimeout(() => {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }, 300);
    }

    overlay.querySelector(".prestige-confirm-btn").addEventListener("click", () => {
      performPrestige();
      closeOverlay();
    });
    overlay.querySelector(".prestige-cancel-btn").addEventListener("click", closeOverlay);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeOverlay();
    });
  }

  function performPrestige() {
    if (!canPrestige()) return;
    const fameGain = getPrestigeFameGain();

    state.prestigeCount += 1;
    state.prestigePoints += fameGain;

    state.money = 0;
    state.employees = {};
    state.completedResearch = [];
    state.activeResearch = null;
    state.completedProjects = [];
    state.activeProject = null;
    state.lifetimeEarnings = 0;
    state.level = 1;
    state.companyValue = 0;
    state.reputation = 0;
    state.builtBuildings = [];

    // 업그레이드는 "특수" 카테고리만 영구 유지
    state.purchasedUpgrades = state.purchasedUpgrades.filter((id) => {
      const upgrade = upgradeTypes.find((u) => u.id === id);
      return upgrade && PRESTIGE_KEEP_CATEGORIES.includes(upgrade.category);
    });

    updateDisplay();
    refreshEmployeeCards();
    refreshUpgradeStore();
    refreshClickButtonLabel();
    refreshResearchSection();
    renderProjectList();
    refreshSynergyBar();
    restoreBuiltBuildings();

    saveGame(false);
  }

  // =========================================================
  // 저장 시스템
  // =========================================================
  const SAVE_KEY = "aitycoon_save";

  function saveGame(showMessage) {
    const data = {
      money: state.money,
      companyValue: state.companyValue,
      reputation: state.reputation,
      level: state.level,
      employees: state.employees,
      purchasedUpgrades: state.purchasedUpgrades,
      completedResearch: state.completedResearch,
      activeResearch: state.activeResearch,
      completedProjects: state.completedProjects,
      activeProject: state.activeProject,
      lifetimeEarnings: state.lifetimeEarnings,
      prestigeCount: state.prestigeCount,
      prestigePoints: state.prestigePoints,
      temporaryEffects: state.temporaryEffects,
      builtBuildings: state.builtBuildings,
      lastSaved: Date.now(),
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    if (showMessage) showSaveMessage();
  }

  // 오프라인 수익 (기본 최대 8시간치, "오프라인 연장" 업그레이드 구매 시 24시간, 확인 버튼을 눌러야 자금에 합산됨)
  let pendingOfflineEarnings = 0;
  let pendingOfflineHours = 0;

  function loadGame() {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return; // 저장 데이터 없으면 기본값 그대로 시작

    try {
      const data = JSON.parse(raw);
      state.money = data.money ?? 0;
      state.companyValue = data.companyValue ?? 0;
      state.reputation = data.reputation ?? 0;
      state.level = data.level ?? 1;
      // 개성 시스템 추가 전 저장 데이터는 { intern: 3 } 같은 숫자 형식이었으므로
      // 배열 형식으로 마이그레이션하면서 무작위 이름/성격을 소급 부여
      state.employees = {};
      Object.entries(data.employees ?? {}).forEach(([id, value]) => {
        if (Array.isArray(value)) {
          state.employees[id] = value;
        } else if (typeof value === "number") {
          state.employees[id] = [];
          for (let i = 0; i < value; i++) {
            state.employees[id].push({ name: randomName(), personality: randomPersonality() });
          }
        }
      });
      state.purchasedUpgrades = data.purchasedUpgrades ?? [];
      state.completedResearch = data.completedResearch ?? [];
      state.activeResearch = data.activeResearch ?? null;
      state.completedProjects = data.completedProjects ?? [];
      state.activeProject = data.activeProject ?? null;
      state.prestigeCount = data.prestigeCount ?? 0;
      state.prestigePoints = data.prestigePoints ?? 0;
      // 프레스티지 기능 추가 전 저장 데이터는 누적 수익 기록이 없으므로 현재 자금을 최소치로 사용
      state.lifetimeEarnings = data.lifetimeEarnings ?? state.money;
      state.temporaryEffects = data.temporaryEffects ?? [];
      state.builtBuildings = data.builtBuildings ?? [];

      if (data.lastSaved) {
        const rawSeconds = Math.max(0, (Date.now() - data.lastSaved) / 1000);
        const cappedSeconds = Math.min(rawSeconds, getMaxOfflineSeconds());
        const income = getIncomePerSecond();
        if (rawSeconds > 60 && income > 0) {
          pendingOfflineEarnings = Math.floor(cappedSeconds * income);
          pendingOfflineHours = cappedSeconds / 3600;
        }
      }
    } catch (e) {
      console.error("저장 데이터를 불러오지 못했습니다.", e);
    }
  }

  // 게임 시작 시 팝업으로 오프라인 수익 안내
  // (index.html/style.css를 직접 수정하지 않기 위해 game.js에서 요소/스타일을 삽입)
  function injectOfflineOverlayStyle() {
    const style = document.createElement("style");
    style.textContent = `
      .offline-overlay {
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(15, 23, 42, 0.55);
        z-index: 1000;
      }
      .offline-card {
        background: #ffffff;
        border-radius: 14px;
        padding: 28px 32px;
        text-align: center;
        max-width: 320px;
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25);
        font-family: "Noto Sans KR", sans-serif;
      }
      .offline-emoji {
        font-size: 40px;
        margin-bottom: 10px;
      }
      .offline-message {
        font-size: 1rem;
        font-weight: 600;
        color: #1e293b;
        margin-bottom: 20px;
        line-height: 1.6;
      }
      .offline-confirm-btn {
        border: none;
        padding: 10px 28px;
        font-family: "Noto Sans KR", sans-serif;
        font-size: 0.9rem;
        font-weight: 700;
        color: #ffffff;
        background: linear-gradient(135deg, #3b82f6, #1d4ed8);
        border-radius: 8px;
        cursor: pointer;
        transition: filter 0.15s ease, transform 0.08s ease;
      }
      .offline-confirm-btn:hover {
        filter: brightness(1.1);
      }
      .offline-confirm-btn:active {
        transform: scale(0.95);
      }
    `;
    document.head.appendChild(style);
  }

  function showOfflineEarningsPopup() {
    if (pendingOfflineEarnings <= 0) return;

    const hoursText = pendingOfflineHours.toFixed(1) + "시간";

    const overlay = document.createElement("div");
    overlay.className = "offline-overlay";
    overlay.innerHTML = `
      <div class="offline-card">
        <div class="offline-emoji">💤</div>
        <div class="offline-message">${hoursText} 동안 $${formatNumber(pendingOfflineEarnings)}를 벌었어요!</div>
        <button type="button" class="offline-confirm-btn">확인</button>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector(".offline-confirm-btn").addEventListener("click", () => {
      state.money += pendingOfflineEarnings;
      state.lifetimeEarnings += pendingOfflineEarnings;
      pendingOfflineEarnings = 0;
      updateDisplay();
      refreshEmployeeCards();
      refreshUpgradeStore();
      document.body.removeChild(overlay);
    });
  }

  // 회사 정보 패널 하단의 수동 저장 버튼 + "저장됨!" 메시지
  // (index.html/style.css를 직접 수정하지 않기 위해 game.js에서 요소/스타일을 삽입)
  let saveMessageEl = null;
  let saveMessageTimer = null;

  function showSaveMessage() {
    if (!saveMessageEl) return;
    saveMessageEl.textContent = "저장됨!";
    saveMessageEl.classList.add("show");
    clearTimeout(saveMessageTimer);
    saveMessageTimer = setTimeout(() => {
      saveMessageEl.classList.remove("show");
    }, 1000);
  }

  function injectSaveButtonStyle() {
    const style = document.createElement("style");
    style.textContent = `
      .save-btn {
        display: block;
        width: 100%;
        margin-top: 16px;
        border: 1px solid var(--color-border-blue, #d6e4fb);
        padding: 10px 14px;
        font-family: "Noto Sans KR", sans-serif;
        font-size: 0.85rem;
        font-weight: 700;
        color: var(--color-primary-dark, #1d4ed8);
        background: var(--color-primary-light, #eaf1ff);
        border-radius: 8px;
        cursor: pointer;
        transition: background-color 0.15s ease, color 0.15s ease, transform 0.08s ease;
      }
      .save-btn:hover {
        background: var(--color-primary, #2563eb);
        color: #ffffff;
      }
      .save-btn:active {
        transform: scale(0.96);
      }
      .save-message {
        display: block;
        margin-top: 8px;
        text-align: center;
        font-size: 0.8rem;
        font-weight: 600;
        color: #16a34a;
        opacity: 0;
        transition: opacity 0.2s ease;
      }
      .save-message.show {
        opacity: 1;
      }
    `;
    document.head.appendChild(style);
  }

  function createSaveButton() {
    const companyInfoPanel = document.querySelector(".panel-company-info");
    if (!companyInfoPanel) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "save-btn";
    button.textContent = "💾 저장";
    button.addEventListener("click", () => saveGame(true));

    saveMessageEl = document.createElement("span");
    saveMessageEl.className = "save-message";

    companyInfoPanel.appendChild(button);
    companyInfoPanel.appendChild(saveMessageEl);
  }

  // =========================================================
  // Firebase 실시간 멀티 대전 시스템
  // 기존 싱글플레이 로직(init 이하)은 그대로 재사용하고, 시작 화면에서
  // 모드를 선택하게 한 뒤 대전 모드일 때만 방/타이머/순위판/동기화를 덧붙인다.
  // 대전 모드는 저장하지 않으며, 최대 4명, 방장이 나가거나 연결이 끊기면
  // 방이 자동 종료된다.
  //
  // 참고: 이 프로젝트엔 아직 업적 시스템이 없어 순위판/결과창의 "달성한 업적"은
  // 항상 0으로 표시됩니다. 또한 Realtime Database엔 서버 예약 삭제 기능이
  // 없어서 "종료 1시간 후 자동 삭제"는 클라이언트가 방에 접근할 때
  // 기회적으로(lazy) 정리하는 방식으로 구현했습니다.
  // =========================================================
  const battleState = {
    active: false,
    roomCode: null,
    playerId: null,
    nickname: null,
    isHost: false,
    timeLimit: null,
    startTime: null,
    players: {},
  };

  let roomListenerRef = null;

  function generateRoomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 헷갈리는 O/0, I/1 제외
    let code = "";
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  function generatePlayerId() {
    return "p_" + Math.random().toString(36).slice(2, 10);
  }

  function injectMultiplayerStyle() {
    const style = document.createElement("style");
    style.textContent = `
      .mp-overlay {
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(15, 23, 42, 0.6);
        z-index: 2000;
        padding: 20px;
      }
      .mp-card {
        background: #ffffff;
        border-radius: 18px;
        padding: 32px 30px;
        text-align: center;
        max-width: 360px;
        width: 100%;
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.3);
        font-family: "Noto Sans KR", sans-serif;
      }
      .mp-title {
        font-size: 1.3rem;
        font-weight: 900;
        color: #1e293b;
        margin-bottom: 4px;
      }
      .mp-subtitle {
        font-size: 0.8rem;
        color: var(--color-text-secondary, #6b7684);
        margin-bottom: 22px;
      }
      .mp-btn {
        display: block;
        width: 100%;
        border: none;
        padding: 14px;
        margin-bottom: 10px;
        font-family: "Noto Sans KR", sans-serif;
        font-size: 0.95rem;
        font-weight: 700;
        border-radius: 10px;
        cursor: pointer;
        transition: filter 0.15s ease, transform 0.08s ease;
      }
      .mp-btn:last-child { margin-bottom: 0; }
      .mp-btn:active { transform: scale(0.97); }
      .mp-btn.primary {
        color: #ffffff;
        background: linear-gradient(135deg, #3b82f6, #1d4ed8);
      }
      .mp-btn.secondary {
        color: #ffffff;
        background: linear-gradient(135deg, #f97316, #ea580c);
      }
      .mp-btn.ghost {
        color: var(--color-text-secondary, #6b7684);
        background: #f1f5f9;
        border: 1px solid var(--color-border-blue, #d6e4fb);
      }
      .mp-btn:hover:not(:disabled) { filter: brightness(1.08); }
      .mp-btn:disabled {
        background: #cbd5e1;
        color: #94a3b8;
        cursor: not-allowed;
      }
      .mp-input {
        width: 100%;
        box-sizing: border-box;
        padding: 12px;
        margin-bottom: 14px;
        border: 1px solid var(--color-border-blue, #d6e4fb);
        border-radius: 8px;
        font-family: "Noto Sans KR", sans-serif;
        font-size: 0.95rem;
        text-align: center;
      }
      .mp-input:focus {
        outline: none;
        border-color: var(--color-primary, #2563eb);
      }
      .mp-label {
        display: block;
        text-align: left;
        font-size: 0.78rem;
        font-weight: 700;
        color: var(--color-text-secondary, #6b7684);
        margin-bottom: 6px;
      }
      .mp-back {
        margin-top: 14px;
        font-size: 0.78rem;
        color: var(--color-text-secondary, #6b7684);
        background: none;
        border: none;
        cursor: pointer;
        text-decoration: underline;
      }
      .mp-room-code {
        font-size: 2rem;
        font-weight: 900;
        letter-spacing: 0.1em;
        color: var(--color-primary, #2563eb);
        margin-bottom: 4px;
      }
      .mp-room-hint {
        font-size: 0.75rem;
        color: var(--color-text-secondary, #6b7684);
        margin-bottom: 20px;
      }
      .mp-player-list {
        text-align: left;
        margin-bottom: 18px;
      }
      .mp-player-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        border-radius: 8px;
        background: #f8faff;
        margin-bottom: 6px;
        font-size: 0.85rem;
      }
      .mp-player-row.empty { color: var(--color-text-faint, #98a2b3); }
      .mp-time-options {
        display: flex;
        gap: 8px;
        margin-bottom: 16px;
      }
      .mp-time-btn {
        flex: 1;
        border: 1px solid var(--color-border-blue, #d6e4fb);
        background: #ffffff;
        color: #1e293b;
        padding: 10px;
        border-radius: 8px;
        font-family: "Noto Sans KR", sans-serif;
        font-size: 0.82rem;
        font-weight: 700;
        cursor: pointer;
      }
      .mp-time-btn.selected {
        background: linear-gradient(135deg, #3b82f6, #1d4ed8);
        color: #ffffff;
        border-color: transparent;
      }
      .battle-timer-value.blinking {
        animation: battleTimerBlink 1s step-start infinite;
      }
      @keyframes battleTimerBlink {
        50% { opacity: 0.2; }
      }
      .mp-leaderboard {
        position: fixed;
        top: 90px;
        right: 16px;
        width: 220px;
        background: #ffffff;
        border: 1px solid var(--color-border-blue, #d6e4fb);
        border-radius: 14px;
        padding: 14px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
        z-index: 500;
        font-family: "Noto Sans KR", sans-serif;
      }
      .mp-leaderboard-title {
        font-size: 0.8rem;
        font-weight: 800;
        color: #1e293b;
        margin-bottom: 8px;
      }
      .mp-leaderboard-row {
        display: flex;
        justify-content: space-between;
        font-size: 0.78rem;
        padding: 4px 0;
        color: #334155;
      }
      .mp-leaderboard-row.me { font-weight: 800; color: var(--color-primary, #2563eb); }
      .mp-results-list {
        text-align: left;
        margin-bottom: 20px;
      }
      .mp-results-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 12px;
        border-radius: 10px;
        background: #f8faff;
        margin-bottom: 6px;
        font-size: 0.88rem;
      }
      .mp-results-row.me { background: #eaf1ff; border: 1px solid var(--color-primary, #2563eb); }
      .mp-my-stats {
        text-align: left;
        background: #f8faff;
        border-radius: 10px;
        padding: 12px 14px;
        font-size: 0.8rem;
        color: #334155;
        line-height: 1.7;
        margin-bottom: 20px;
      }
      .mp-results-buttons {
        display: flex;
        gap: 8px;
      }
      .mp-results-buttons .mp-btn { margin-bottom: 0; }
    `;
    document.head.appendChild(style);
  }

  // ---- ① 모드 선택 ----
  function showModeSelectModal() {
    injectMultiplayerStyle();

    const overlay = document.createElement("div");
    overlay.className = "mp-overlay";
    overlay.innerHTML = `
      <div class="mp-card">
        <div class="mp-title">🤖 AI TYCOON</div>
        <div class="mp-subtitle">플레이 방식을 선택하세요</div>
        <button type="button" class="mp-btn primary" id="soloModeBtn">🎮 혼자 하기</button>
        <button type="button" class="mp-btn secondary" id="battleModeBtn">⚔️ 대전 하기</button>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector("#soloModeBtn").addEventListener("click", () => {
      overlay.remove();
      init();
    });
    overlay.querySelector("#battleModeBtn").addEventListener("click", () => {
      overlay.remove();
      showBattleSetupModal();
    });
  }

  // ---- ② 대전 모드 선택 (닉네임 + 방 만들기/참가하기) ----
  function showBattleSetupModal() {
    const overlay = document.createElement("div");
    overlay.className = "mp-overlay";
    overlay.innerHTML = `
      <div class="mp-card">
        <div class="mp-title">대전 방 설정</div>
        <div class="mp-subtitle">닉네임을 입력하고 방을 만들거나 참가하세요</div>
        <label class="mp-label">닉네임</label>
        <input type="text" class="mp-input" id="nicknameInput" maxlength="10" placeholder="닉네임을 입력하세요">
        <button type="button" class="mp-btn primary" id="createRoomBtn">🏠 방 만들기</button>
        <button type="button" class="mp-btn secondary" id="joinRoomBtn">🚪 방 참가하기</button>
        <button type="button" class="mp-back" id="battleSetupBackBtn">← 처음으로</button>
      </div>
    `;
    document.body.appendChild(overlay);

    function getNickname() {
      const input = overlay.querySelector("#nicknameInput");
      const value = input.value.trim();
      if (!value) {
        input.focus();
        return null;
      }
      return value;
    }

    overlay.querySelector("#createRoomBtn").addEventListener("click", () => {
      const nickname = getNickname();
      if (!nickname) return;
      overlay.remove();
      createRoom(nickname);
    });
    overlay.querySelector("#joinRoomBtn").addEventListener("click", () => {
      const nickname = getNickname();
      if (!nickname) return;
      overlay.remove();
      showJoinRoomModal(nickname);
    });
    overlay.querySelector("#battleSetupBackBtn").addEventListener("click", () => {
      overlay.remove();
      showModeSelectModal();
    });
  }

  // ---- ③ 방 참가하기 (코드 입력) ----
  function showJoinRoomModal(nickname) {
    const overlay = document.createElement("div");
    overlay.className = "mp-overlay";
    overlay.innerHTML = `
      <div class="mp-card">
        <div class="mp-title">방 코드 입력</div>
        <div class="mp-subtitle">친구에게 받은 6자리 코드를 입력하세요</div>
        <input type="text" class="mp-input" id="roomCodeInput" maxlength="6" placeholder="ABC123" style="text-transform:uppercase; letter-spacing:0.2em; font-weight:800;">
        <button type="button" class="mp-btn primary" id="submitJoinBtn">참가하기</button>
        <button type="button" class="mp-back" id="joinBackBtn">← 뒤로</button>
      </div>
    `;
    document.body.appendChild(overlay);

    const codeInput = overlay.querySelector("#roomCodeInput");
    codeInput.addEventListener("input", () => {
      codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    });

    overlay.querySelector("#submitJoinBtn").addEventListener("click", () => {
      const code = codeInput.value.trim();
      if (code.length !== 6) {
        codeInput.focus();
        return;
      }
      overlay.remove();
      joinRoom(code, nickname);
    });
    overlay.querySelector("#joinBackBtn").addEventListener("click", () => {
      overlay.remove();
      showBattleSetupModal();
    });
  }

  // ---- ④ 방 만들기 ----
  function createRoom(nickname) {
    battleState.playerId = generatePlayerId();
    battleState.nickname = nickname;
    battleState.isHost = true;
    battleState.roomCode = generateRoomCode();

    console.log("[MP] createRoom 시작", { roomCode: battleState.roomCode, nickname });

    const roomRef = db.ref("rooms/" + battleState.roomCode);
    roomRef
      .set({
        host: nickname,
        status: "waiting",
        timeLimit: null,
        startTime: null,
        createdAt: firebase.database.ServerValue.TIMESTAMP,
        players: {
          [battleState.playerId]: {
            nickname,
            money: 0,
            employees: 0,
            projects: 0,
            achievements: 0,
            isHost: true,
          },
        },
      })
      .then(() => {
        console.log("[MP] createRoom 성공 — Firebase에 저장됨:", "rooms/" + battleState.roomCode);
        // 실제로 저장됐는지 즉시 재조회해서 확인
        roomRef.once("value").then((snap) => {
          console.log("[MP] createRoom 재조회 결과:", snap.val());
        });
        // 방장이 연결을 끊으면(창을 닫는 등) 방이 자동 종료되도록 설정
        roomRef.onDisconnect().update({
          status: "ended",
          endedAt: firebase.database.ServerValue.TIMESTAMP,
        });
        showWaitingRoom();
        listenToRoom();
      })
      .catch((err) => {
        console.error("[MP] 방 생성 실패", err);
        alert("방 생성에 실패했습니다. Firebase 설정을 확인해주세요. (콘솔에서 상세 오류를 확인하세요)");
      });
  }

  // ---- ⑤ 방 참가하기 ----
  function joinRoom(code, nickname) {
    console.log("[MP] joinRoom 시작", { code, nickname });
    const roomRef = db.ref("rooms/" + code);
    let joined = false;
    let aborted = false; // room.set()이 성공하면 undefined를 resolve하므로, 조기 종료 여부는
                          // 반환값이 아니라 이 플래그로 판별해야 한다.
    roomRef
      .once("value")
      .then((snap) => {
        const room = snap.val();
        console.log("[MP] joinRoom 조회 결과:", room);
        if (!room) {
          alert("존재하지 않는 방 코드입니다.");
          aborted = true;
          return null;
        }
        // 종료된 지 1시간 지난 방은 접근한 김에 정리 (서버 예약 삭제가 없어 클라이언트에서 대신 처리)
        if (room.status === "ended" && room.endedAt && Date.now() - room.endedAt > 60 * 60 * 1000) {
          roomRef.remove();
          alert("만료된 방입니다.");
          aborted = true;
          return null;
        }
        if (room.status !== "waiting") {
          alert("이미 시작되었거나 종료된 방입니다.");
          aborted = true;
          return null;
        }
        const players = room.players || {};
        if (Object.keys(players).length >= 4) {
          alert("방 인원이 가득 찼습니다. (최대 4명)");
          aborted = true;
          return null;
        }

        battleState.playerId = generatePlayerId();
        battleState.nickname = nickname;
        battleState.isHost = false;
        battleState.roomCode = code;

        return roomRef.child("players/" + battleState.playerId).set({
          nickname,
          money: 0,
          employees: 0,
          projects: 0,
          achievements: 0,
          isHost: false,
        });
      })
      .then(() => {
        if (aborted) return;
        joined = true;
        console.log("[MP] joinRoom 성공 — players에 등록됨:", battleState.playerId);
        showWaitingRoom();
        listenToRoom();
      })
      .catch((err) => {
        console.error("[MP] 방 참가 실패", err);
        if (!joined) alert("방 참가에 실패했습니다. (콘솔에서 상세 오류를 확인하세요)");
      });
  }

  // ---- ⑥ 대기 화면 ----
  let waitingRoomOverlayEl = null;

  function showWaitingRoom() {
    const overlay = document.createElement("div");
    overlay.className = "mp-overlay";
    overlay.id = "waitingRoomOverlay";

    const timeOptionsHtml = battleState.isHost
      ? `
        <label class="mp-label">시간 선택</label>
        <div class="mp-time-options" id="timeOptions">
          <button type="button" class="mp-time-btn" data-seconds="600">10분</button>
          <button type="button" class="mp-time-btn" data-seconds="900">15분</button>
          <button type="button" class="mp-time-btn" data-seconds="1200">20분</button>
        </div>
        <button type="button" class="mp-btn primary" id="startBattleBtn" disabled>🚀 게임 시작</button>
        <div class="mp-room-hint" id="startHint">2명 이상 참가 시 활성화됩니다</div>
      `
      : `<div class="mp-room-hint">⏳ 방장이 게임을 시작하기를 기다리는 중...</div>`;

    overlay.innerHTML = `
      <div class="mp-card">
        <div class="mp-room-code">${battleState.roomCode}</div>
        <div class="mp-room-hint">방 코드를 친구에게 공유하세요</div>
        <label class="mp-label">참가자</label>
        <div class="mp-player-list" id="waitingPlayerList"></div>
        ${timeOptionsHtml}
        <button type="button" class="mp-back" id="leaveRoomBtn">❌ 나가기</button>
      </div>
    `;
    document.body.appendChild(overlay);
    waitingRoomOverlayEl = overlay;

    if (battleState.isHost) {
      overlay.querySelectorAll(".mp-time-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          overlay.querySelectorAll(".mp-time-btn").forEach((b) => b.classList.remove("selected"));
          btn.classList.add("selected");
          db.ref("rooms/" + battleState.roomCode).update({ timeLimit: Number(btn.dataset.seconds) });
        });
      });
      overlay.querySelector("#startBattleBtn").addEventListener("click", () => {
        db.ref("rooms/" + battleState.roomCode).update({
          status: "playing",
          startTime: firebase.database.ServerValue.TIMESTAMP,
        });
      });
    }

    overlay.querySelector("#leaveRoomBtn").addEventListener("click", () => {
      leaveBattleRoom();
      overlay.remove();
      location.reload();
    });
  }

  function renderWaitingRoomPlayers() {
    if (!waitingRoomOverlayEl) return;
    const listEl = waitingRoomOverlayEl.querySelector("#waitingPlayerList");
    if (!listEl) return;

    const players = Object.values(battleState.players || {});
    const rows = [];
    for (let i = 0; i < 4; i++) {
      const p = players[i];
      if (p) {
        rows.push(`<div class="mp-player-row">${p.isHost ? "👑" : "👤"} ${p.nickname}${p.isHost ? " (방장)" : ""}</div>`);
      } else {
        rows.push('<div class="mp-player-row empty">⏳ 대기 중...</div>');
      }
    }
    listEl.innerHTML = rows.join("");

    if (battleState.isHost) {
      const startBtn = waitingRoomOverlayEl.querySelector("#startBattleBtn");
      const hint = waitingRoomOverlayEl.querySelector("#startHint");
      if (startBtn) {
        const canStart = players.length >= 2 && !!battleState.timeLimit;
        startBtn.disabled = !canStart;
        hint.textContent =
          players.length < 2 ? "2명 이상 참가 시 활성화됩니다" : !battleState.timeLimit ? "제한 시간을 선택해주세요" : "";
      }
    }
  }

  function hideWaitingRoom() {
    if (waitingRoomOverlayEl) {
      waitingRoomOverlayEl.remove();
      waitingRoomOverlayEl = null;
    }
  }

  // ---- ⑦ 방 상태 실시간 구독 ----
  function listenToRoom() {
    roomListenerRef = db.ref("rooms/" + battleState.roomCode);
    roomListenerRef.on(
      "value",
      (snap) => {
        const room = snap.val();
        console.log("[MP] listenToRoom 업데이트:", room);
        if (!room) return;

        battleState.players = room.players || {};
        battleState.timeLimit = room.timeLimit || null;
        battleState.startTime = room.startTime || null;

        if (room.status === "waiting") {
          renderWaitingRoomPlayers();
        } else if (room.status === "playing") {
          if (!battleState.active) {
            battleState.active = true;
            hideWaitingRoom();
            startBattleGame();
          }
          refreshLeaderboard();
        } else if (room.status === "ended") {
          if (battleState.active || waitingRoomOverlayEl) {
            battleState.active = false;
            hideWaitingRoom();
            showBattleResults(room);
          }
        }
      },
      (err) => {
        // 여기가 찍히면 대부분 Firebase 보안 규칙(Realtime Database Rules)에 의한 Permission denied
        console.error("[MP] listenToRoom 구독 오류:", err);
        alert("실시간 동기화에 실패했습니다: " + err.message);
      }
    );
  }

  function leaveBattleRoom() {
    if (roomListenerRef) {
      roomListenerRef.off();
      roomListenerRef = null;
    }
    if (battleState.roomCode && battleState.playerId) {
      db.ref("rooms/" + battleState.roomCode + "/players/" + battleState.playerId).remove();
      if (battleState.isHost) {
        db.ref("rooms/" + battleState.roomCode).update({
          status: "ended",
          endedAt: firebase.database.ServerValue.TIMESTAMP,
        });
      }
    }
  }

  // ---- ⑧ 대전 시작 (기존 싱글 로직 재사용) ----
  function startBattleGame() {
    init({ battleMode: true });
    createBattleTimerStat();
    createLeaderboardPanel();
    startBattleTimerLoop();
    startBattleSync();
  }

  let battleTimerEl = null;

  function createBattleTimerStat() {
    const headerStats = document.querySelector(".header-stats");
    if (!headerStats) return;

    const item = document.createElement("div");
    item.className = "stat-item";
    item.innerHTML = `
      <span class="stat-icon">⏱️</span>
      <div class="stat-text">
        <span class="stat-label">남은 시간</span>
        <span class="stat-value battle-timer-value" style="color:#dc2626;">--:--</span>
      </div>
    `;
    headerStats.appendChild(item);
    battleTimerEl = item.querySelector(".battle-timer-value");
  }

  function startBattleTimerLoop() {
    const timerInterval = setInterval(() => {
      if (!battleState.active || !battleTimerEl || !battleState.startTime || !battleState.timeLimit) return;
      const elapsed = (Date.now() - battleState.startTime) / 1000;
      const remaining = Math.max(0, Math.round(battleState.timeLimit - elapsed));
      const m = Math.floor(remaining / 60);
      const s = remaining % 60;
      battleTimerEl.textContent = String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
      battleTimerEl.classList.toggle("blinking", remaining <= 60 && remaining > 0);

      if (remaining <= 0) {
        clearInterval(timerInterval);
        if (battleState.isHost) {
          db.ref("rooms/" + battleState.roomCode).update({
            status: "ended",
            endedAt: firebase.database.ServerValue.TIMESTAMP,
          });
        }
      }
    }, 1000);
  }

  function startBattleSync() {
    setInterval(() => {
      if (!battleState.active || !battleState.roomCode) return;
      const totalEmployees = employeeTypes.reduce((sum, t) => sum + getEmployeeCount(t.id), 0);
      db.ref("rooms/" + battleState.roomCode + "/players/" + battleState.playerId).update({
        money: Math.floor(state.money),
        employees: totalEmployees,
        projects: state.completedProjects.length,
        achievements: 0, // 이 프로젝트엔 업적 시스템이 없어 0으로 고정
      });
    }, 1000);
  }

  // ---- ⑨ 실시간 순위판 ----
  let leaderboardEl = null;

  function createLeaderboardPanel() {
    const panel = document.createElement("div");
    panel.className = "mp-leaderboard";
    panel.innerHTML = `
      <div class="mp-leaderboard-title">🏆 실시간 순위</div>
      <div id="leaderboardRows"></div>
    `;
    document.body.appendChild(panel);
    leaderboardEl = panel.querySelector("#leaderboardRows");
    refreshLeaderboard();
  }

  function refreshLeaderboard() {
    if (!leaderboardEl) return;
    const ranked = Object.entries(battleState.players || {})
      .map(([id, p]) => Object.assign({ id }, p))
      .sort((a, b) => (b.money || 0) - (a.money || 0));

    leaderboardEl.innerHTML = ranked
      .map((p, i) => {
        const isMe = p.id === battleState.playerId;
        const name = isMe ? "나" : p.nickname;
        return (
          '<div class="mp-leaderboard-row ' +
          (isMe ? "me" : "") +
          '">' +
          (i + 1) +
          "위 " +
          name +
          " <span>$" +
          formatNumber(p.money || 0) +
          "</span></div>"
        );
      })
      .join("");
  }

  // ---- ⑩ 결과 화면 ----
  function showBattleResults(room) {
    const ranked = Object.entries(room.players || {})
      .map(([id, p]) => Object.assign({ id }, p))
      .sort((a, b) => (b.money || 0) - (a.money || 0));

    const medals = ["👑", "🥈", "🥉"];
    const rowsHtml = ranked
      .map((p, i) => {
        const isMe = p.id === battleState.playerId;
        const name = isMe ? "나" : p.nickname;
        return `
          <div class="mp-results-row ${isMe ? "me" : ""}">
            <span>${i + 1}위 ${medals[i] || ""} ${name}</span>
            <span>$${formatNumber(p.money || 0)}</span>
          </div>
        `;
      })
      .join("");

    const totalEmployees = employeeTypes.reduce((sum, t) => sum + getEmployeeCount(t.id), 0);

    const overlay = document.createElement("div");
    overlay.className = "mp-overlay";
    overlay.innerHTML = `
      <div class="mp-card">
        <div class="mp-title">🏆 최종 결과</div>
        <div class="mp-subtitle">대전이 종료되었습니다</div>
        <div class="mp-results-list">${rowsHtml}</div>
        <div class="mp-my-stats">
          나의 기록<br>
          - 채용한 직원: ${totalEmployees}명<br>
          - 완료한 프로젝트: ${state.completedProjects.length}개<br>
          - 달성한 업적: 0개
        </div>
        <div class="mp-results-buttons">
          <button type="button" class="mp-btn primary" id="restartBtn">🔄 다시 하기</button>
          <button type="button" class="mp-btn ghost" id="homeBtn">🏠 홈으로</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector("#restartBtn").addEventListener("click", () => {
      leaveBattleRoom();
      location.reload();
    });
    overlay.querySelector("#homeBtn").addEventListener("click", () => {
      leaveBattleRoom();
      location.reload();
    });
  }

  // =========================================================
  // 사무실 캐릭터 애니메이션 (JS/CSS만 사용, HTML 구조 변경 없음)
  // .office-view 내부에 캐릭터 레이어를 JS로 삽입하고, 보유 직원 수에 맞춰
  // 최대치까지만 이모지 캐릭터를 걸어다니게 한다.
  // =========================================================
  const CHARACTER_CAPS = { intern: 5, developer: 4, researcher: 3, architect: 2, director: 1 };
  const SPEECH_LINES = [
    "코딩 중...",
    "회의 중...",
    "커피 마시러 가요",
    "버그 발견!",
    "아이디어 있어요!",
    "야근 싫어요...",
  ];

  let officeCharacters = [];
  let officeCharactersEl = null;
  let officePlaceholderEl = null;
  let officeBgLayerEl = null;
  let officeBgFadeTimer = null;
  let hireToastEl = null;
  let hireToastTimer = null;

  function injectOfficeCharacterStyle() {
    const style = document.createElement("style");
    style.textContent = `
      .office-view {
        position: relative;
        overflow: hidden;
      }

      /* 배경 레이어: 레벨 전환 시 이 레이어만 페이드 아웃→교체→페이드 인 (총 0.5초, JS가 opacity를 제어) */
      .office-bg-layer {
        position: absolute;
        inset: 0;
        z-index: 0;
        opacity: 1;
        transition: opacity 0.25s ease;
      }

      /* Lv1 차고 (극빈): 어두운 콘크리트 단색 + 미세한 균열 패턴 */
      .office-bg-lv1 {
        background-color: #3a3a3a;
        background-image:
          repeating-linear-gradient(115deg, rgba(0,0,0,0.16) 0 2px, transparent 2px 46px),
          repeating-linear-gradient(25deg, rgba(0,0,0,0.12) 0 2px, transparent 2px 60px),
          radial-gradient(ellipse 140px 90px at 20% 30%, rgba(0,0,0,0.14), transparent 70%),
          radial-gradient(ellipse 160px 100px at 75% 65%, rgba(0,0,0,0.1), transparent 70%);
      }

      /* Lv2 작은 사무실 (서민): 나무색 단색 + 가로 나무판 줄무늬 */
      .office-bg-lv2 {
        background-color: #c4956a;
        background-image:
          repeating-linear-gradient(0deg, rgba(90,55,25,0.22) 0 2px, transparent 2px 46px),
          repeating-linear-gradient(0deg, rgba(255,255,255,0.08) 2px 3px, transparent 3px 46px);
      }

      /* Lv3 빌딩 (중산층): 청회색 단색 + 균일한 카펫 크로스해치 질감 */
      .office-bg-lv3 {
        background-color: #7a9eb5;
        background-image:
          repeating-linear-gradient(45deg, rgba(255,255,255,0.06) 0 2px, transparent 2px 5px),
          repeating-linear-gradient(-45deg, rgba(0,0,0,0.05) 0 2px, transparent 2px 5px);
      }

      /* Lv4 고층빌딩 (부유): 진한 원목색 단색 + 가로 나무결 줄무늬 + 광택 대각선 */
      .office-bg-lv4 {
        background-color: #6b3f1e;
        background-image:
          linear-gradient(120deg, transparent 40%, rgba(255,255,255,0.12) 50%, transparent 60%),
          repeating-linear-gradient(0deg, rgba(0,0,0,0.24) 0 2px, transparent 2px 42px),
          repeating-linear-gradient(0deg, rgba(255,255,255,0.07) 2px 3px, transparent 3px 42px);
      }

      /* Lv5 AI 캠퍼스 (부자): 딥 네이비 단색 + 은은한 대리석 결 */
      .office-bg-lv5 {
        background-color: #0d1b2a;
        background-image:
          linear-gradient(35deg, transparent 30%, rgba(200,210,230,0.1) 31%, transparent 33%),
          linear-gradient(-50deg, transparent 55%, rgba(200,210,230,0.08) 56%, transparent 58%),
          linear-gradient(15deg, transparent 75%, rgba(200,210,230,0.06) 76%, transparent 78%);
      }

      /* Lv6 AI City (초럭셔리): 검정 단색 + 금빛 대리석 결 + 은은한 골드 글로우 */
      .office-bg-lv6 {
        background-color: #1a1200;
        background-image:
          linear-gradient(35deg, transparent 30%, rgba(250,204,21,0.4) 31%, transparent 33%),
          linear-gradient(-50deg, transparent 55%, rgba(250,204,21,0.3) 56%, transparent 58%),
          linear-gradient(10deg, transparent 75%, rgba(250,204,21,0.32) 76%, transparent 78%);
      }
      .office-bg-lv6::before {
        content: "";
        position: absolute;
        inset: 0;
        background: radial-gradient(circle at 50% 78%, rgba(250,204,21,0.22), transparent 60%);
        animation: officeGoldGlow 4s ease-in-out infinite;
        pointer-events: none;
      }
      @keyframes officeGoldGlow {
        0%, 100% { opacity: 0.55; }
        50% { opacity: 1; }
      }

      .office-placeholder {
        position: relative;
        z-index: 2;
      }
      .office-characters {
        position: absolute;
        inset: 0;
        z-index: 2;
        pointer-events: none;
      }
      .office-character {
        position: absolute;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: auto;
        cursor: pointer;
        user-select: none;
      }
      .office-character-emoji {
        font-size: 26px;
        display: inline-block;
        filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.25));
      }
      .office-character.entering .office-character-emoji {
        animation: officeCharacterPop 0.4s ease;
      }
      @keyframes officeCharacterPop {
        0% { transform: scale(0); }
        70% { transform: scale(1.2); }
        100% { transform: scale(1); }
      }
      .office-speech-bubble {
        position: absolute;
        bottom: 36px;
        left: 50%;
        transform: translateX(-50%) scale(0.85);
        background: #ffffff;
        border: 1px solid var(--color-border-blue, #d6e4fb);
        border-radius: 10px;
        padding: 4px 8px;
        font-size: 0.66rem;
        font-weight: 700;
        color: #1e293b;
        white-space: nowrap;
        box-shadow: 0 4px 10px rgba(0, 0, 0, 0.18);
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.15s ease, transform 0.15s ease;
      }
      .office-speech-bubble.show {
        opacity: 1;
        transform: translateX(-50%) scale(1);
      }
      .office-hire-toast {
        position: absolute;
        top: 12px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 3;
        background: rgba(255, 255, 255, 0.95);
        border: 1px solid var(--color-border-blue, #d6e4fb);
        border-radius: 999px;
        padding: 6px 14px;
        font-size: 0.8rem;
        font-weight: 800;
        color: #1e293b;
        opacity: 0;
        transition: opacity 0.2s ease;
        pointer-events: none;
      }
      .office-hire-toast.show {
        opacity: 1;
      }
    `;
    document.head.appendChild(style);
  }

  function createOfficeCharacterLayer() {
    const officeView = document.querySelector(".office-view");
    if (!officeView) return;

    officePlaceholderEl = officeView.querySelector(".office-placeholder");

    // 배경 레이어를 맨 먼저 삽입해서 캐릭터/말풍선/입사 토스트보다 뒤에 깔리게 한다
    officeBgLayerEl = document.createElement("div");
    officeBgLayerEl.className = "office-bg-layer office-bg-lv" + state.level;
    officeView.insertBefore(officeBgLayerEl, officeView.firstChild);

    createOfficeBuildingsLayer();

    officeCharactersEl = document.createElement("div");
    officeCharactersEl.className = "office-characters";
    officeView.appendChild(officeCharactersEl);

    hireToastEl = document.createElement("div");
    hireToastEl.className = "office-hire-toast";
    hireToastEl.textContent = "🎉 새 직원 입사!";
    officeView.appendChild(hireToastEl);
  }

  // 레벨이 바뀔 때만 배경을 갈아끼운다: 0.25초 페이드 아웃 → 배경 교체 → 0.25초 페이드 인 (총 0.5초)
  function updateOfficeBackground() {
    if (!officeBgLayerEl) return;
    const newClass = "office-bg-lv" + state.level;
    if (officeBgLayerEl.classList.contains(newClass)) return;

    clearTimeout(officeBgFadeTimer);
    officeBgLayerEl.style.opacity = "0";
    officeBgFadeTimer = setTimeout(() => {
      for (let lv = 1; lv <= 6; lv++) officeBgLayerEl.classList.remove("office-bg-lv" + lv);
      officeBgLayerEl.classList.add(newClass);
      officeBgLayerEl.style.opacity = "1";
    }, 250);
  }

  function showHireToast() {
    if (!hireToastEl) return;
    hireToastEl.classList.add("show");
    clearTimeout(hireToastTimer);
    hireToastTimer = setTimeout(() => hireToastEl.classList.remove("show"), 1000);
  }

  function showSpeechBubble(character) {
    let bubble = character.bubbleEl;
    if (!bubble) {
      bubble = document.createElement("div");
      bubble.className = "office-speech-bubble";
      character.el.appendChild(bubble);
      character.bubbleEl = bubble;
    }
    bubble.textContent = SPEECH_LINES[Math.floor(Math.random() * SPEECH_LINES.length)];
    bubble.classList.add("show");
    clearTimeout(character.bubbleTimeout);
    character.bubbleTimeout = setTimeout(() => bubble.classList.remove("show"), 2000);
  }

  function createCharacterElement(type, isNewHire) {
    if (!officeCharactersEl) return;

    const el = document.createElement("div");
    el.className = "office-character" + (isNewHire ? " entering" : "");

    const emoji = document.createElement("span");
    emoji.className = "office-character-emoji";
    emoji.textContent = type.icon;
    el.appendChild(emoji);

    const containerWidth = officeCharactersEl.clientWidth || 300;
    const containerHeight = officeCharactersEl.clientHeight || 400;
    const startX = isNewHire ? -32 : Math.random() * Math.max(0, containerWidth - 32);
    // 직원은 화면 하단 30%(위에서 70%~95% 지점 = 아래에서 5%~30% 지점)에서만 이동
    const bottomPercent = 5 + Math.random() * 25;

    el.style.bottom = (containerHeight * bottomPercent) / 100 + "px";
    el.style.left = startX + "px";
    officeCharactersEl.appendChild(el);

    const character = {
      typeId: type.id,
      el,
      emojiEl: emoji,
      x: startX,
      direction: Math.random() < 0.5 ? 1 : -1,
      speed: 0.5 + Math.random() * 0.7, // 틱(50ms)당 이동 px — 느리게~보통
      walking: true,
      idleUntil: 0,
      bubbleEl: null,
      bubbleTimeout: null,
    };

    el.addEventListener("click", (e) => {
      e.stopPropagation();
      showSpeechBubble(character);
    });

    officeCharacters.push(character);

    if (isNewHire) showHireToast();
  }

  function removeCharacterElement(character) {
    const idx = officeCharacters.indexOf(character);
    if (idx !== -1) officeCharacters.splice(idx, 1);
    clearTimeout(character.bubbleTimeout);
    if (character.el && character.el.parentNode) character.el.parentNode.removeChild(character.el);
  }

  // 보유 직원 수(직종별 최대치까지)에 맞춰 화면 캐릭터 수를 맞춘다.
  // hireEmployee 직후엔 justHiredTypeId를 넘겨서 새로 늘어난 캐릭터에 입장 애니메이션을 붙인다.
  function syncOfficeCharacters(justHiredTypeId) {
    if (!officeCharactersEl) return;

    employeeTypes.forEach((type) => {
      const cap = CHARACTER_CAPS[type.id] || 0;
      const desired = Math.min(getEmployeeCount(type.id), cap);
      const current = officeCharacters.filter((c) => c.typeId === type.id);

      if (current.length < desired) {
        const toAdd = desired - current.length;
        for (let i = 0; i < toAdd; i++) {
          createCharacterElement(type, type.id === justHiredTypeId);
        }
      } else if (current.length > desired) {
        current.slice(0, current.length - desired).forEach(removeCharacterElement);
      }
    });

    if (officePlaceholderEl) {
      officePlaceholderEl.style.display = officeCharacters.length > 0 ? "none" : "";
    }
  }

  function tickOfficeCharacters() {
    if (!officeCharactersEl || officeCharacters.length === 0) return;
    const containerWidth = officeCharactersEl.clientWidth;
    const maxX = Math.max(0, containerWidth - 32);
    const now = Date.now();

    officeCharacters.forEach((c) => {
      if (!c.walking) {
        if (now >= c.idleUntil) c.walking = true;
        return;
      }

      let nextX = c.x + c.direction * c.speed;
      let nextDirection = c.direction;

      if (nextX <= 0) {
        nextX = 0;
        nextDirection = 1;
      } else if (nextX >= maxX) {
        nextX = maxX;
        nextDirection = -1;
      }

      c.x = nextX;
      c.direction = nextDirection;
      c.el.style.left = c.x + "px";
      c.emojiEl.style.transform = c.direction === -1 ? "scaleX(-1)" : "scaleX(1)";

      // 가끔(평균 15~20초에 한 번꼴) 멈춰서 1~2초 대기
      if (Math.random() < 0.003) {
        c.walking = false;
        c.idleUntil = now + 1000 + Math.random() * 1000;
      }
    });
  }

  // =========================================================
  // 사무실 건물 건설 시스템 (JS/CSS만 사용)
  // 건물은 배경 구역 구분 없이 사무실 화면 중앙에 고정 좌표(x%, y%)로 모여서 배치된다.
  // 직원은 하단 30%(Y 70%~95%) 영역에서만 걸어다니므로 건물과 겹치지 않아 별도 회피 로직은 없다.
  // =========================================================
  const buildingTypes = [
    { id: "server_room", name: "서버실", icon: "🖥️", cost: 500, desc: "전체 수익 +10%", effect: "totalMult", value: 1.1 },
    { id: "cafeteria", name: "카페테리아", icon: "☕", cost: 2000, desc: "직원 수익 +20%", effect: "employeeMult", value: 1.2 },
    { id: "research_wing", name: "연구동", icon: "🔬", cost: 10000, desc: "연구 시간 -30%", effect: "researchSpeed", value: 0.7 },
    { id: "gym", name: "헬스장", icon: "🏋️", cost: 50000, desc: "전체 수익 +25%", effect: "totalMult", value: 1.25 },
    { id: "rocket_pad", name: "로켓발사대", icon: "🚀", cost: 500000, desc: "전체 수익 x2", effect: "totalMult", value: 2 },
  ];

  // 최대 5개, 지어진 순서대로 배정 — 화면 중앙에 모여있는 느낌의 고정 좌표
  const BUILDING_POSITIONS = [
    { x: 50, y: 20 },
    { x: 20, y: 40 },
    { x: 80, y: 40 },
    { x: 30, y: 60 },
    { x: 70, y: 60 },
  ];

  function hasBuilding(id) {
    return state.builtBuildings.includes(id);
  }

  function getBuildingTotalMultiplier() {
    return buildingTypes
      .filter((b) => b.effect === "totalMult" && hasBuilding(b.id))
      .reduce((mult, b) => mult * b.value, 1);
  }

  function getBuildingEmployeeMultiplier() {
    return buildingTypes
      .filter((b) => b.effect === "employeeMult" && hasBuilding(b.id))
      .reduce((mult, b) => mult * b.value, 1);
  }

  function getBuildingResearchSpeedMultiplier() {
    return buildingTypes
      .filter((b) => b.effect === "researchSpeed" && hasBuilding(b.id))
      .reduce((mult, b) => mult * b.value, 1);
  }

  // placedBuildings: [{ typeId, el }] — 화면에 실제로 배치된 건물(애니메이션용, 저장 대상 아님)
  let placedBuildings = [];
  let officeBuildingsEl = null;
  let buildButtonEl = null;
  let buildPopupEl = null;

  function injectBuildingStyle() {
    const style = document.createElement("style");
    style.textContent = `
      .office-build-btn {
        border: none;
        padding: 14px 22px;
        font-family: "Noto Sans KR", sans-serif;
        font-size: 0.9rem;
        font-weight: 700;
        color: #ffffff;
        background: linear-gradient(135deg, #f59e0b, #b45309);
        border-radius: 10px;
        cursor: pointer;
        white-space: nowrap;
        box-shadow: 0 6px 16px rgba(180, 83, 9, 0.35);
        transition: filter 0.15s ease, transform 0.08s ease;
      }
      .office-build-btn:hover {
        filter: brightness(1.1);
      }
      .office-build-btn:active {
        transform: scale(0.94);
      }
      .office-buildings {
        position: absolute;
        inset: 0;
        z-index: 1;
        pointer-events: none;
      }
      .office-building {
        position: absolute;
        transform: translate(-50%, -50%);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
      }
      .office-building-emoji {
        display: inline-block;
        font-size: 48px;
        line-height: 1;
        filter: drop-shadow(0 3px 4px rgba(0, 0, 0, 0.35));
      }
      .office-building-name {
        font-size: 0.7rem;
        font-weight: 800;
        color: #ffffff;
        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.7);
        white-space: nowrap;
      }
      .office-building.constructing .office-building-emoji {
        animation: buildingCraneShake 0.5s ease-in-out infinite;
      }
      .office-building.built-pop .office-building-emoji {
        animation: buildingPop 0.4s ease;
      }
      @keyframes buildingCraneShake {
        0%, 100% { transform: rotate(-3deg); }
        50% { transform: rotate(3deg); }
      }
      @keyframes buildingPop {
        0% { transform: scale(0); }
        70% { transform: scale(1.25); }
        100% { transform: scale(1); }
      }
      .build-overlay {
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(15, 23, 42, 0.6);
        z-index: 2100;
        padding: 20px;
      }
      .build-card {
        background: #ffffff;
        border-radius: 18px;
        padding: 26px 24px;
        max-width: 360px;
        width: 100%;
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.3);
        font-family: "Noto Sans KR", sans-serif;
      }
      .build-card-title {
        font-size: 1.1rem;
        font-weight: 900;
        color: #1e293b;
        text-align: center;
        margin-bottom: 16px;
      }
      .build-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px;
        margin-bottom: 8px;
        background: #f8faff;
        border: 1px solid var(--color-border-blue, #d6e4fb);
        border-radius: 10px;
      }
      .build-item:last-child { margin-bottom: 0; }
      .build-item-icon { flex-shrink: 0; font-size: 1.4rem; }
      .build-item-info { flex: 1; min-width: 0; }
      .build-item-name { font-size: 0.85rem; font-weight: 700; color: #1e293b; }
      .build-item-desc { font-size: 0.7rem; color: var(--color-text-secondary, #6b7684); margin-top: 2px; }
      .build-item-btn {
        flex-shrink: 0;
        border: none;
        padding: 8px 12px;
        font-family: "Noto Sans KR", sans-serif;
        font-size: 0.72rem;
        font-weight: 700;
        color: #ffffff;
        background: linear-gradient(135deg, #f59e0b, #b45309);
        border-radius: 8px;
        cursor: pointer;
        white-space: nowrap;
      }
      .build-item-btn:disabled {
        background: #cbd5e1;
        color: #94a3b8;
        cursor: not-allowed;
      }
      .build-item-done {
        flex-shrink: 0;
        font-size: 0.85rem;
        font-weight: 800;
        color: #16a34a;
      }
      .build-close-btn {
        display: block;
        width: 100%;
        margin-top: 16px;
        border: 1px solid var(--color-border-blue, #d6e4fb);
        background: #f1f5f9;
        color: var(--color-text-secondary, #6b7684);
        padding: 10px;
        border-radius: 8px;
        font-family: "Noto Sans KR", sans-serif;
        font-size: 0.82rem;
        font-weight: 700;
        cursor: pointer;
      }
      .building-complete-overlay {
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(15, 23, 42, 0.5);
        z-index: 2200;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.3s ease;
      }
      .building-complete-overlay.show { opacity: 1; }
      .building-complete-card {
        background: linear-gradient(135deg, #f59e0b, #b45309);
        border-radius: 16px;
        padding: 30px 36px;
        text-align: center;
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
        font-family: "Noto Sans KR", sans-serif;
      }
      .building-complete-emoji { font-size: 40px; margin-bottom: 8px; }
      .building-complete-message { font-size: 1.05rem; font-weight: 800; color: #ffffff; }
    `;
    document.head.appendChild(style);
  }

  function createBuildButton() {
    const controls = getOrCreateOfficeControls();
    if (!controls) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "office-build-btn";
    button.textContent = "🏗️ 건설";
    button.addEventListener("click", openBuildPopup);

    controls.appendChild(button);
    buildButtonEl = button;
  }

  function createOfficeBuildingsLayer() {
    const officeView = document.querySelector(".office-view");
    if (!officeView) return;
    officeBuildingsEl = document.createElement("div");
    officeBuildingsEl.className = "office-buildings";
    officeView.appendChild(officeBuildingsEl);
  }

  function openBuildPopup() {
    const overlay = document.createElement("div");
    overlay.className = "build-overlay";
    overlay.innerHTML = `
      <div class="build-card">
        <div class="build-card-title">🏗️ 건물 건설</div>
        <div id="buildItemList"></div>
        <button type="button" class="build-close-btn" id="buildCloseBtn">닫기</button>
      </div>
    `;
    document.body.appendChild(overlay);
    buildPopupEl = overlay;

    overlay.querySelector("#buildCloseBtn").addEventListener("click", () => {
      overlay.remove();
      buildPopupEl = null;
    });
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        overlay.remove();
        buildPopupEl = null;
      }
    });

    renderBuildPopup();
  }

  function renderBuildPopup() {
    if (!buildPopupEl) return;
    const list = buildPopupEl.querySelector("#buildItemList");
    if (!list) return;

    list.innerHTML = buildingTypes
      .map((b) => {
        const built = hasBuilding(b.id);
        let actionHtml;
        if (built) {
          actionHtml = `<div class="build-item-done">✅ 완료</div>`;
        } else {
          const disabled = state.money < b.cost || state.builtBuildings.length >= 5;
          actionHtml = `<button type="button" class="build-item-btn" data-id="${b.id}" ${disabled ? "disabled" : ""}>건설 · $${b.cost.toLocaleString()}</button>`;
        }
        return `
          <div class="build-item">
            <div class="build-item-icon">${b.icon}</div>
            <div class="build-item-info">
              <div class="build-item-name">${b.name}</div>
              <div class="build-item-desc">${b.desc}</div>
            </div>
            ${actionHtml}
          </div>
        `;
      })
      .join("");

    list.querySelectorAll(".build-item-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const type = buildingTypes.find((b) => b.id === btn.dataset.id);
        if (type) startBuildConstruction(type);
      });
    });
  }

  function startBuildConstruction(type) {
    if (hasBuilding(type.id)) return;
    if (state.builtBuildings.length >= 5) return;
    if (state.money < type.cost) return;

    state.money -= type.cost;
    state.builtBuildings.push(type.id);

    updateDisplay();
    refreshEmployeeCards();
    refreshUpgradeStore();
    renderBuildPopup();

    spawnBuilding(type, true);
  }

  // isNew: true면 🏗️ 크레인으로 2초간 표시했다가 실제 건물로 교체(+완료 팝업),
  // false면 (저장된 데이터 복원 등) 처음부터 완성된 건물로 바로 표시
  function spawnBuilding(type, isNew) {
    if (!officeBuildingsEl) return;
    const slotIndex = state.builtBuildings.indexOf(type.id);
    if (slotIndex === -1 || slotIndex >= BUILDING_POSITIONS.length) return;
    const pos = BUILDING_POSITIONS[slotIndex];

    const el = document.createElement("div");
    el.className = "office-building";
    el.style.left = pos.x + "%";
    el.style.top = pos.y + "%";

    const emojiEl = document.createElement("span");
    emojiEl.className = "office-building-emoji";
    emojiEl.textContent = isNew ? "🏗️" : type.icon;
    el.appendChild(emojiEl);

    const nameEl = document.createElement("span");
    nameEl.className = "office-building-name";
    nameEl.textContent = type.name;
    el.appendChild(nameEl);

    officeBuildingsEl.appendChild(el);
    placedBuildings.push({ typeId: type.id, el });

    if (isNew) {
      el.classList.add("constructing");
      setTimeout(() => {
        emojiEl.textContent = type.icon;
        el.classList.remove("constructing");
        el.classList.add("built-pop");
        showBuildingCompletePopup(type);
      }, 2000);
    }
  }

  function showBuildingCompletePopup(type) {
    const overlay = document.createElement("div");
    overlay.className = "building-complete-overlay";
    overlay.innerHTML = `
      <div class="building-complete-card">
        <div class="building-complete-emoji">🎉</div>
        <div class="building-complete-message">${type.name} 건설 완료!</div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("show"));

    setTimeout(() => {
      overlay.classList.remove("show");
      setTimeout(() => {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }, 300);
    }, 3000);
  }

  // 저장된 건물 목록을 완성된 상태로 즉시 복원 (건설 애니메이션 없이)
  function restoreBuiltBuildings() {
    placedBuildings.forEach((b) => {
      if (b.el && b.el.parentNode) b.el.parentNode.removeChild(b.el);
    });
    placedBuildings = [];
    state.builtBuildings.forEach((id) => {
      const type = buildingTypes.find((b) => b.id === id);
      if (type) spawnBuilding(type, false);
    });
  }

  // =========================================================
  // 초기화(리셋) 버튼
  // 회사 정보 패널 맨 하단에 추가. 대전 모드는 애초에 저장하지 않으므로
  // 혼자 하기 모드에서만 생성한다 (init에서 !battleMode일 때만 호출).
  // 확인 팝업은 Firebase 멀티플레이 시스템에서 쓰던 .mp-overlay/.mp-card/.mp-btn
  // 스타일을 그대로 재사용한다(showModeSelectModal에서 이미 주입돼 있음).
  // =========================================================
  function injectResetButtonStyle() {
    const style = document.createElement("style");
    style.textContent = `
      .reset-btn {
        display: block;
        width: 100%;
        margin-top: 16px;
        border: 1px solid rgba(220, 38, 38, 0.3);
        padding: 10px 14px;
        font-family: "Noto Sans KR", sans-serif;
        font-size: 0.85rem;
        font-weight: 700;
        color: #dc2626;
        background: rgba(220, 38, 38, 0.06);
        border-radius: 8px;
        cursor: pointer;
        transition: background-color 0.15s ease, color 0.15s ease, transform 0.08s ease;
      }
      .reset-btn:hover {
        background: #dc2626;
        color: #ffffff;
      }
      .reset-btn:active {
        transform: scale(0.97);
      }
    `;
    document.head.appendChild(style);
  }

  function createResetButton() {
    const companyInfoPanel = document.querySelector(".panel-company-info");
    if (!companyInfoPanel) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "reset-btn";
    button.textContent = "🔄 초기화";
    button.addEventListener("click", openResetConfirm);

    companyInfoPanel.appendChild(button);
  }

  // beforeunload 자동 저장이 초기화 직후의 reload에서 방금 지운 localStorage를
  // 다시 채워버리는 것을 막기 위한 플래그
  let isResetting = false;

  function openResetConfirm() {
    if (confirm("정말 초기화하시겠습니까?\n모든 데이터가 삭제됩니다.")) {
      isResetting = true;
      localStorage.clear();
      location.reload();
    }
  }

  // =========================================================
  // 초기화
  // =========================================================
  function init(options) {
    const battleMode = !!(options && options.battleMode);

    if (!battleMode) loadGame(); // 대전 모드는 저장 데이터를 불러오지 않고 항상 새로 시작
    state.level = getLevelForMoney(state.money).level; // 불러온 자금 기준으로 조용히 맞춰둠 (레벨업 팝업 없이)

    moneyEl = findStatValueByIcon("💰");
    companyValueEl = findStatValueByIcon("📈");
    reputationEl = findStatValueByIcon("⭐");
    levelEl = findStatValueByIcon("🏢");
    createIncomeRateStat();
    createPrestigeStat();

    injectClickButtonStyle();
    createClickButton();

    injectSaveButtonStyle();
    createSaveButton();

    injectEmployeeCardStyle();
    createEmployeePanel();

    injectSynergyStyle();
    createSynergySection();

    injectLevelUpOverlayStyle();
    createLevelNameRow();

    injectUpgradeStoreStyle();
    createUpgradeStore();
    refreshClickButtonLabel();

    injectResearchStyle();
    createResearchSection();

    injectProjectStyle();
    renderProjectList();

    injectPrestigeStyle();
    createPrestigeSection();

    if (!battleMode) {
      injectResetButtonStyle();
      createResetButton();
    }

    injectOfficeCharacterStyle();
    createOfficeCharacterLayer();
    syncOfficeCharacters();

    injectBuildingStyle();
    createBuildButton();
    restoreBuiltBuildings();

    updateDisplay();

    if (!battleMode) {
      setInterval(() => saveGame(false), 10000);
      window.addEventListener("beforeunload", () => {
        if (!isResetting) saveGame(false);
      });
    }

    // 직원 초당 수익 지급 (0.2초 간격으로 누적, 창의적 성격의 실시간 스파이크 반영) + 연구/프로젝트 진행률·완료 체크
    setInterval(() => {
      const income = getLiveIncomePerSecond();
      if (income > 0) {
        const gained = income * 0.2;
        state.money += gained;
        state.lifetimeEarnings += gained;
        updateDisplay();
        refreshEmployeeCards();
        refreshUpgradeStore();
      }
      checkResearchCompletion();
      refreshResearchSection();
      checkProjectCompletion();
      renderProjectList();
      refreshSynergyBar();
      syncOfficeCharacters();
    }, 200);

    // 사무실 캐릭터 걷기 애니메이션 (0.05초 간격)
    setInterval(tickOfficeCharacters, 50);

    // 자동 클릭봇 업그레이드 보유 시 초당 1회 자동 클릭
    // + 창의적 성격의 스파이크 판정 (1초마다: 10% 확률로 다음 1초간 수익 3배)
    setInterval(() => {
      if (hasUpgrade("auto_clicker")) {
        earnMoney(getClickValue());
      }
      employeeTypes.forEach((type) => {
        getEmployeeList(type.id).forEach((emp) => {
          if (emp.personality === "creative") {
            creativeSpikes.set(emp, Math.random() < 0.1);
          }
        });
      });
    }, 1000);

    if (!battleMode) {
      injectOfflineOverlayStyle();
      showOfflineEarningsPopup();
    }

    injectEventStyle();
    createEventModal();
    scheduleNextRandomEvent();
  }

  document.addEventListener("DOMContentLoaded", showModeSelectModal);
})();

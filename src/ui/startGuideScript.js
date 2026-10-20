function buildStartGuideScript() {
  return `
    const guide = document.getElementById('startGuide');
    const guideToggle = document.getElementById('showStartGuide');
    const guideLanguage = document.getElementById('guideLanguage');
    const guideExecution = document.getElementById('guideExecutionMode');
    const syncChoices = document.getElementById('guideSyncChoices');
    const syncChange = document.getElementById('guideChangeSync');
    const syncPrimary = document.getElementById('guideSyncPrimary');
    let syncState = {};
    let syncCategory;
    let syncExpanded = false;
    function renderSync(state) {
      syncState = state;
      const category = state.localSelected ? 'local'
        : state.checkFailed ? 'unknown'
        : state.syncError || (state.syncing ? 'syncing'
        : state.configured && state.syncEnabled && state.syncVerified ? 'ready' : 'setup');
      if (category !== syncCategory) syncExpanded = false;
      syncCategory = category;
      const collapsible = category === 'local' || category === 'ready';
      syncChoices.hidden = collapsible && !syncExpanded;
      syncChange.hidden = !collapsible;
      syncChange.textContent = syncExpanded ? '접기' : '변경';
      syncChange.setAttribute('aria-expanded', String(!syncChoices.hidden));
      document.getElementById('guideSyncState').textContent = category === 'local' ? '이 컴퓨터에서만 사용 중'
        : category === 'unknown' ? 'Git 설정을 확인하지 못했습니다. Git 설치 상태를 확인해주세요.'
        : category === 'conflict' ? '동기화 충돌이 있습니다. 충돌 해결이 필요합니다.'
        : category === 'failed' ? '동기화에 실패했습니다. 연결·인증 정보를 확인해주세요.'
        : category === 'syncing' ? '동기화 중입니다…'
        : category === 'ready' ? '✓ 동기화 설정 완료'
        : state.configured ? (state.syncEnabled ? '연결 설정됨 · 동기화 확인 필요' : '연결 설정됨 · 동기화 꺼짐')
        : '저장소 연결 전 · 파일은 이 컴퓨터에 저장됩니다.';
      syncPrimary.hidden = !state.configured;
      syncPrimary.textContent = !state.syncEnabled ? '동기화 켜기'
        : category === 'conflict' ? '충돌 해결' : category === 'failed' ? '다시 동기화' : '지금 동기화';
      document.getElementById('guideSyncInfo').hidden = !state.configured;
      document.getElementById('guideSetupSync').textContent = state.configured ? '연결 변경' : '동기화 설정하기';
      document.getElementById('guideCreateRepository').hidden = state.configured;
      for (const id of ['guideSyncPrimary', 'guideSetupSync', 'guideLocalOnly']) {
        document.getElementById(id).disabled = Boolean(state.syncing);
      }
    }
    syncChange.addEventListener('click', () => {
      syncExpanded = !syncExpanded;
      renderSync(syncState);
    });
    syncPrimary.addEventListener('click', () => guideAction(syncState.syncEnabled ? 'syncNow' : 'enableSync'));
    document.getElementById('guideSyncInfo').addEventListener('click', () => guideAction('syncInfo'));
    let guideInitialized = false;
    function showGuide(show) {
      guide.hidden = !show;
      guideToggle.setAttribute('aria-expanded', String(show));
      guideToggle.textContent = show ? '안내 접기' : '시작 안내';
    }
    function guideAction(action, extra = {}) {
      vscode.postMessage({ type: 'startGuide', action, ...extra });
    }
    guideToggle.addEventListener('click', () => showGuide(guide.hidden));
    document.getElementById('openHelperSettings').addEventListener('click', () => guideAction('settings'));
    document.getElementById('guideAllSettings').addEventListener('click', () => guideAction('settings'));
    document.getElementById('guideSetupSync').addEventListener('click', () => guideAction('sync'));
    document.getElementById('guideLocalOnly').addEventListener('click', () => guideAction('local'));
    document.getElementById('guideCreateRepository').addEventListener('click', () => guideAction('repository'));
    document.getElementById('guideComplete').addEventListener('click', () => guideAction('complete'));
    guideLanguage.addEventListener('change', () => {
      guideLanguage.disabled = true;
      guideAction('setting', { key: 'language', value: guideLanguage.value });
    });
    guideExecution.addEventListener('change', () => {
      guideExecution.disabled = true;
      guideAction('setting', { key: 'executionMode', value: guideExecution.value });
    });
    window.addEventListener('message', event => {
      if (event.data.type === 'startGuideCompleted') {
        showGuide(false);
        guideToggle.focus();
      }
      if (event.data.type !== 'startGuideState') return;
      const state = event.data;
      guideLanguage.value = state.language;
      guideExecution.value = state.executionMode;
      guideLanguage.disabled = false;
      guideExecution.disabled = false;
      document.getElementById('guideComplete').disabled = false;
      document.getElementById('guideRuntimeHelp').textContent = state.executionMode === 'docker'
        ? 'Docker 설치 후 실행해 두세요. Windows에서는 Docker 사용을 권장합니다.'
        : '로컬에 선택한 언어의 컴파일러 또는 인터프리터가 필요합니다.';
      renderSync(state);
      if (!guideInitialized) {
        guideInitialized = true;
        showGuide(!state.completed);
      }
    });`;
}

module.exports = { buildStartGuideScript };

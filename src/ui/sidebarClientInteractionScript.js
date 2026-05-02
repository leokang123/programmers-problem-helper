// Sidebar Webview client script 조각입니다. buildSidebarClientScript에서 순서대로 이어 붙입니다.
function buildSidebarClientInteractionScript() {
  return `    // 커스텀 테스트 입력/기댓값 textarea 한 쌍을 추가합니다.
    function addTest(inputValue = '', expectedValue = '') {
      testCount += 1;
      const card = document.createElement('div');
      card.className = 'test-card';
      card.innerHTML =
        '<div class="test-head"><span>테스트 #' + testCount + '</span><button class="remove" type="button">삭제</button></div>' +
        '<label>Input</label>' +
        '<textarea class="test-input" spellcheck="false" placeholder="solution 인자를 쉼표로 입력"></textarea>' +
        '<label>Expected Output</label>' +
        '<textarea class="test-expected" spellcheck="false" placeholder="기대 결과를 현재 언어 리터럴 형태로 입력"></textarea>';
      card.querySelector('.test-input').value = inputValue;
      card.querySelector('.test-expected').value = expectedValue;
      card.querySelector('.remove').addEventListener('click', () => {
        card.remove();
        updatePaneSummaries();
        updateCustomTestsSaveState();
      });
      card.querySelector('.test-input').addEventListener('input', () => {
        updateCustomTestsSaveState();
      });
      card.querySelector('.test-expected').addEventListener('input', () => {
        updateCustomTestsSaveState();
      });
      customTests.appendChild(card);
      updatePaneSummaries();
      updateCustomTestsSaveState();
    }

    // extension에서 받은 저장된 커스텀 테스트를 입력 UI에 채웁니다.
    function setCustomTests(tests, markSaved = true) {
      customTests.innerHTML = '';
      testCount = 0;
      if (!Array.isArray(tests) || tests.length === 0) {
        addTest();
        if (markSaved) {
          savedCustomTests = collectTests();
          savedCustomTestsSignature = JSON.stringify(savedCustomTests);
          updateCustomTestsSaveState();
        }
        return;
      }
      for (const test of tests) {
        const inputValue = typeof test.inputsText === 'string' ? test.inputsText : (test.inputs || []).join(', ');
        const expectedValue = typeof test.expectedText === 'string' ? test.expectedText : (test.expected || '');
        addTest(inputValue, expectedValue);
      }
      if (markSaved) {
        savedCustomTests = collectTests();
        savedCustomTestsSignature = JSON.stringify(savedCustomTests);
        updateCustomTestsSaveState();
      }
    }

    // Webview 입력 UI에서 비어 있지 않은 커스텀 테스트들을 수집합니다.
    function collectTests() {
      return Array.from(document.querySelectorAll('.test-card')).map((card) => ({
        inputsText: card.querySelector('.test-input').value.trim(),
        expectedText: card.querySelector('.test-expected').value.trim()
      })).filter((test) => test.inputsText || test.expectedText);
    }

    // 저장 여부 비교를 위해 현재 커스텀 테스트 입력을 문자열 signature로 만듭니다.
    function getCustomTestsSignature() {
      return JSON.stringify(collectTests());
    }

    // 현재 커스텀 테스트 입력이 저장본과 다른지 저장 버튼 상태에 반영합니다.
    function updateCustomTestsSaveState() {
      const dirty = getCustomTestsSignature() !== savedCustomTestsSignature;
      saveCustomTestsButton.disabled = !currentProblemDir || !dirty;
      saveCustomTestsButton.textContent = dirty ? '저장' : '저장됨';
    }

    // 문제 생성 중 중복 요청을 막도록 생성 버튼과 입력 상태를 바꿉니다.
    function setCreateBusy(busy) {
      createBusy = busy;
      input.disabled = busy;
      createButton.disabled = busy;
      createButton.textContent = busy ? '생성 중' : '생성 및 열기';
    }

    // 풀이 기록 row 클릭을 extension의 snapshot 열기 메시지로 변환합니다.
    function openSnapshot(row) {
      selectedSnapshotKey = getSnapshotSelectionKey(row.problem.problemDir, row.snapshot.path);
      renderProblems();
      saveSidebarState();
      vscode.postMessage({
        type: 'openSolutionSnapshot',
        problemDir: row.problem.problemDir,
        snapshotPath: row.snapshot.path
      });
    }

    // 문제 번호 입력을 검증하고 extension에 문제 생성 메시지를 보냅니다.
    function submitCreateProblem() {
      if (createBusy) return;

      const lessonId = input.value.trim();
      if (!/^\\d{1,10}$/.test(lessonId)) {
        status.textContent = '오류\\n\\n문제 번호는 1~10자리 숫자로 입력해주세요.';
        status.className = 'status error';
        updatePaneSummaries();
        return;
      }

      setCreateBusy(true);
      vscode.postMessage({ type: 'create', lessonId });
    }

    // 현재 커스텀 테스트 입력을 extension에 실행 요청으로 보냅니다.
    function submitCustomTests() {
      if (!currentProblemDir) return;
      vscode.postMessage({ type: 'runCustom', problemDir: currentProblemDir, tests: collectTests() });
    }

    // 현재 커스텀 테스트 입력을 extension에 저장 요청으로 보냅니다.
    function submitSaveCustomTests() {
      if (!currentProblemDir) return;
      saveCustomTestsButton.disabled = true;
      saveCustomTestsButton.textContent = '저장 중';
      vscode.postMessage({ type: 'saveCustomTests', problemDir: currentProblemDir, tests: collectTests() });
    }

    // 문제 목록/풀이 기록 영역의 이벤트 위임 클릭을 각 extension 메시지로 변환합니다.
    function handleProblemListClick(event) {
      const problemRow = event.target.closest('.problem-row');
      const snapshotRow = event.target.closest('.snapshot-row');

      if (problemRow) {
        const problem = renderedProblems[Number(problemRow.dataset.index)];
        if (!problem) return;
        if (event.target.closest('.review-check')) {
          vscode.postMessage({
            type: 'toggleReview',
            problemDir: problem.problemDir,
            review: event.target.checked
          });
          return;
        }
        if (event.target.closest('.delete-problem')) {
          vscode.postMessage({
            type: 'deleteProblem',
            problemDir: problem.problemDir
          });
          return;
        }
        selectedSnapshotKey = '';
        renderProblems();
        saveSidebarState();
        vscode.postMessage({ type: 'openProblem', problemDir: problem.problemDir });
        return;
      }

      if (snapshotRow) {
        const row = renderedSnapshots[Number(snapshotRow.dataset.index)];
        if (!row) return;
        if (event.target.closest('.delete-snapshot')) {
          if (selectedSnapshotKey === getSnapshotSelectionKey(row.problem.problemDir, row.snapshot.path)) {
            selectedSnapshotKey = '';
            renderProblems();
            saveSidebarState();
          }
          vscode.postMessage({
            type: 'deleteSolutionSnapshot',
            problemDir: row.problem.problemDir,
            snapshotPath: row.snapshot.path
          });
          return;
        }
        openSnapshot(row);
      }
    }

    addTest();
    restoreSidebarState();
    sidebarStateReady = true;
    createButton.addEventListener('click', submitCreateProblem);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submitCreateProblem();
      }
    });
    runSamples.addEventListener('click', () => {
      if (!currentProblemDir) return;
      vscode.postMessage({ type: 'runSamples', problemDir: currentProblemDir });
    });
    document.getElementById('addTest').addEventListener('click', () => {
      addTest();
    });
    saveCustomTestsButton.addEventListener('click', submitSaveCustomTests);
    runCustom.addEventListener('click', submitCustomTests);
    document.getElementById('stopRun').addEventListener('click', () => {
      vscode.postMessage({ type: 'stopTests' });
    });
    resetCurrentSolution.addEventListener('click', () => {
      if (!currentProblemDir) return;
      vscode.postMessage({
        type: 'resetCurrentSolution',
        problemDir: currentProblemDir
      });
    });
    timerToggle.addEventListener('click', () => {
      if (!currentProblemDir) return;
      vscode.postMessage({
        type: activeTimer?.isRunning ? 'pauseTimer' : 'startTimer',
        problemDir: currentProblemDir
      });
    });
    timerReset.addEventListener('click', () => {
      if (!currentProblemDir) return;
      resetTimerNotifications();
      activeTimer = {
        ...normalizeTimer(activeTimer),
        elapsedMs: 0,
        startedAt: null,
        isRunning: false
      };
      updateTimerUi();
      saveSidebarState();
      vscode.postMessage({
        type: 'resetTimer',
        problemDir: currentProblemDir
      });
    });
    timerTarget.addEventListener('change', () => {
      if (!currentProblemDir) return;
      resetTimerNotifications();
      saveSidebarState();
      vscode.postMessage({
        type: 'setTimerTarget',
        problemDir: currentProblemDir,
        targetMinutes: Number(timerTarget.value)
      });
    });
    startCurrentReview.addEventListener('click', () => {
      if (!currentProblemDir) return;
      vscode.postMessage({
        type: 'startReviewAttempt',
        problemDir: currentProblemDir
      });
    });
    openNotes.addEventListener('click', () => {
      if (!currentProblemDir) return;
      vscode.postMessage({
        type: 'openNotes',
        problemDir: currentProblemDir
      });
    });
    openWebsite.addEventListener('click', () => {
      if (!currentProblemDir) return;
      vscode.postMessage({
        type: 'openWebsite',
        problemDir: currentProblemDir
      });
    });
    document.getElementById('toggleTop').addEventListener('click', (event) => {
      togglePane(topPane, event.currentTarget, 'top-collapsed');
    });
    document.getElementById('toggleTests').addEventListener('click', (event) => {
      togglePane(testsPane, event.currentTarget, 'tests-collapsed');
    });
    document.getElementById('toggleList').addEventListener('click', (event) => {
      togglePane(listPane, event.currentTarget, 'list-collapsed');
    });
    document.querySelectorAll('input[name="problemFilter"]').forEach((filter) => {
      filter.addEventListener('change', () => {
        renderProblems();
        if (filter.value === 'solutions') {
          scrollSelectedSnapshotIntoView();
        } else {
          scrollCurrentProblemIntoView();
        }
        updatePaneSummaries();
        saveSidebarState();
      });
    });
    problemSearch.addEventListener('input', () => {
      scheduleRenderProblems();
    });
    document.getElementById('refreshProblems').addEventListener('click', () => {
      vscode.postMessage({ type: 'refreshProblems', force: true });
    });
    problemList.addEventListener('scroll', scheduleProblemListScrollSave, { passive: true });
    problemList.addEventListener('click', handleProblemListClick);
    window.addEventListener('message', (event) => {
      if (event.data.type === 'status') {
        status.textContent = event.data.text;
        status.className = 'status ' + (event.data.kind || '');
        updatePaneSummaries();
      }
      if (event.data.type === 'createBusy') {
        setCreateBusy(Boolean(event.data.busy));
      }
      if (event.data.type === 'testRunning') {
        document.getElementById('stopRun').disabled = !event.data.running;
      }
      if (event.data.type === 'customTests') {
        setCustomTests(event.data.tests || []);
        updatePaneSummaries();
        saveSidebarState();
      }
      if (event.data.type === 'customTestsSaved') {
        savedCustomTests = Array.isArray(event.data.tests) ? event.data.tests : [];
        savedCustomTestsSignature = JSON.stringify(savedCustomTests);
        updateCustomTestsSaveState();
        saveSidebarState();
      }
      if (event.data.type === 'problems') {
        problems = event.data.problems || [];
        renderProblems();
        restoreProblemListScrollTop();
        saveSidebarState();
      }
      if (event.data.type === 'currentProblem') {
        const previousProblemDir = currentProblemDir;
        currentProblem = event.data.problem;
        currentProblemDir = currentProblem?.problemDir || '';
        if (currentProblemDir !== previousProblemDir) {
          selectedSnapshotKey = '';
        }
        savedCustomTests = [];
        savedCustomTestsSignature = '';
        activeTimer = undefined;
        resetTimerNotifications();
        updateCurrentActions();
        renderProblems();
        scrollCurrentProblemIntoView();
        saveSidebarState();
        if (currentProblemDir) {
          vscode.postMessage({ type: 'getTimer', problemDir: currentProblemDir });
        } else {
          updateTimerUi();
        }
      }
      if (event.data.type === 'timerState') {
        applyTimerState(event.data.timer);
      }
      if (event.data.type === 'runCustomRequest') {
        submitCustomTests();
      }
    });
    updateCurrentActions();
    updatePaneSummaries();
    if (currentProblemDir) {
      vscode.postMessage({ type: 'getTimer', problemDir: currentProblemDir });
    }
    vscode.postMessage({ type: 'webviewReady' });
    vscode.postMessage({ type: 'refreshProblems' });`;
}

module.exports = {
  buildSidebarClientInteractionScript,
};

const {
  buildSidebarClientScript,
} = require("./sidebarClientScript");
const {
  buildSidebarStyles,
} = require("./sidebarStyles");

// Webview에 삽입할 HTML 문자열을 만듭니다.
function buildSidebarHtml(nonce) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
${buildSidebarStyles()}
  </style>
</head>
<body>
  <div class="app">
    <section id="topPane" class="pane top-pane collapsible-pane">
      <button id="toggleTop" class="pane-title toggle-title" type="button" aria-expanded="true">
        <span class="toggle-icon">▾</span>
        <span class="toggle-label">문제 열기 / 현재 상태</span>
        <span id="topSummary" class="toggle-summary"></span>
        <span class="collapsed-badge">닫힘</span>
      </button>
      <div class="pane-body">
        <div class="section">
          <label for="lessonId">Programmers 문제 번호</label>
          <div class="open-row">
            <input id="lessonId" placeholder="468379" inputmode="numeric" />
            <button id="create">생성 및 열기</button>
          </div>
        </div>
        <div class="status-slot">
          <div id="status" class="status">대기 중

문제 번호를 입력하고 생성 버튼을 누르세요.</div>
        </div>
        <div class="current-actions">
          <button id="resetCurrentSolution" class="secondary" disabled>초기화</button>
          <button id="startCurrentReview" class="secondary" disabled>새풀이</button>
          <button id="openNotes" class="secondary" disabled>메모</button>
          <button id="openWebsite" class="secondary" disabled title="현재 풀이 코드를 복사하고 프로그래머스 원문 열기">웹</button>
        </div>
        <div id="timerPanel" class="timer-panel">
          <div id="timerDisplay" class="timer-display">⏱ 00:00 / 60m</div>
          <div class="timer-controls">
            <select id="timerTarget" class="timer-target" title="목표 시간" disabled>
              <option value="20">20m</option>
              <option value="30">30m</option>
              <option value="60" selected>60m</option>
              <option value="90">90m</option>
              <option value="120">120m</option>
            </select>
            <div class="timer-buttons">
              <button id="timerToggle" class="secondary" disabled>시작</button>
              <button id="timerReset" class="secondary" disabled>초기화</button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section id="testsPane" class="pane collapsible-pane">
      <button id="toggleTests" class="pane-title toggle-title" type="button" aria-expanded="true">
        <span class="toggle-icon">▾</span>
        <span class="toggle-label">테스트 실행</span>
        <span id="testsSummary" class="toggle-summary"></span>
        <span class="collapsed-badge">닫힘</span>
      </button>
      <div class="pane-body">
        <div class="test-actions">
          <div class="test-actions-grid">
            <button id="run">샘플 테스트 실행</button>
            <button id="stopRun" class="secondary" disabled>실행 중지</button>
          </div>
        </div>
        <div class="tests-content">
          <div class="section">
            <label>커스텀 테스트케이스</label>
            <div id="customTests"></div>
            <div class="custom-actions">
              <button id="addTest" class="secondary">+ 테스트 추가</button>
              <button id="saveCustomTests" class="secondary" disabled>저장됨</button>
            </div>
            <button id="runCustom">커스텀 테스트 실행</button>
            <div class="hint">참고 · Docker 컨테이너는 VS Code 종료 시 자동 정리됩니다.</div>
          </div>
        </div>
      </div>
    </section>

    <section id="listPane" class="pane collapsible-pane">
      <button id="toggleList" class="pane-title toggle-title" type="button" aria-expanded="true">
        <span class="toggle-icon">▾</span>
        <span class="toggle-label">문제 목록</span>
        <span id="listSummary" class="toggle-summary"></span>
        <span class="collapsed-badge">닫힘</span>
      </button>
      <div class="pane-body">
        <div class="list-actions">
          <label class="filter"><input name="problemFilter" type="radio" value="all" checked /> 전체</label>
          <label class="filter"><input name="problemFilter" type="radio" value="review" /> 다시풀</label>
          <label class="filter"><input name="problemFilter" type="radio" value="solutions" /> 풀이기록</label>
          <button id="refreshProblems" class="secondary refresh" title="새로고침">↻</button>
          <input id="problemSearch" class="search" type="text" placeholder="문제 번호 또는 제목 검색" />
        </div>
        <div id="problemList" class="problem-list"></div>
      </div>
    </section>
  </div>
  <script nonce="${nonce}">
${buildSidebarClientScript()}
  </script>
</body>
</html>`;
}

module.exports = {
  buildSidebarHtml,
};

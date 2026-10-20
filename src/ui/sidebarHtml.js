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
      <div class="guide-toolbar">
        <button id="showStartGuide" class="secondary" aria-controls="startGuide" aria-expanded="false">시작 안내</button>
        <button id="openHelperSettings" class="secondary">설정</button>
      </div>
      <section id="startGuide" class="start-guide" aria-label="처음 사용 설정" hidden>
        <h2>처음 사용 설정</h2>
        <p>현재 설정으로 바로 시작해도 됩니다. 아래에서 바꾼 값은 즉시 적용됩니다.</p>
        <label for="guideLanguage">풀이 언어</label>
        <select id="guideLanguage" disabled><option value="cpp">C++</option><option value="java">Java</option><option value="python">Python</option></select>
        <label for="guideExecutionMode">테스트 실행 방식</label>
        <select id="guideExecutionMode" disabled><option value="docker">Docker</option><option value="local">로컬</option></select>
        <p id="guideRuntimeHelp">Docker는 설치 및 실행이 필요합니다. 로컬은 해당 언어의 컴파일러 또는 인터프리터가 필요합니다.</p>
        <h3>다른 컴퓨터와 동기화</h3>
        <p>GitHub 저장소를 연결하면 문제와 풀이 기록을 다른 컴퓨터에서도 이어서 사용할 수 있습니다. 동기화 없이도 모든 풀이 기능을 사용할 수 있습니다.</p>
        <p id="guideSyncState" role="status">현재 설정을 확인하고 있습니다…</p>
        <button id="guideChangeSync" class="secondary" hidden aria-controls="guideSyncChoices" aria-expanded="false">변경</button>
        <div id="guideSyncChoices">
        <button id="guideSyncPrimary" hidden>동기화 켜기</button>
        <button id="guideSyncInfo" class="secondary" hidden>연결·인증 정보 확인</button>
        <button id="guideSetupSync">동기화 설정하기</button>
        <button id="guideLocalOnly" class="secondary">이 컴퓨터에서만 사용</button>
        <button id="guideCreateRepository" class="secondary">GitHub에서 저장소 만들기 ↗</button>
        <p>GitHub에 저장소를 먼저 준비하세요. 설정 완료 시 현재 파일을 커밋하고 원격 저장소와 동기화합니다.</p>
        </div>
        <details><summary>더 조정할 수 있는 설정</summary>
          <ul>
            <li>탭 유지 방식: 문제 전환 시 기존 풀이 탭 유지</li>
            <li>테스트 제한 시간: 테스트 한 개의 최대 실행 시간</li>
            <li>C++ 컴파일러·표준: 사용할 컴파일러와 C++ 버전</li>
            <li>동기화: 시작 시 자동 가져오기·상태 확인 주기</li>
            <li>성능 진단: 느릴 때만 켜는 시간 측정 로그</li>
          </ul>
        </details>
        <button id="guideAllSettings" class="secondary">전체 설정 보기</button>
        <button id="guideComplete" disabled>이 설정으로 시작</button>
      </section>
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
      <div class="list-heading">
      <button id="toggleList" class="pane-title toggle-title" type="button" aria-expanded="true">
        <span class="toggle-icon">▾</span>
        <span class="toggle-label">문제 목록</span>
        <span id="listSummary" class="toggle-summary"></span>
        <span class="collapsed-badge">닫힘</span>
      </button>
      <button id="maximizeList" class="secondary" type="button" aria-pressed="false" title="문제 목록을 사이드바 전체 높이로 보기">크게 보기</button>
      </div>
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

// Sidebar Webview client script 조각입니다. buildSidebarClientScript에서 순서대로 이어 붙입니다.
function buildSidebarClientListScript() {
  return `    // 문제 번호, 제목, 폴더명이 검색어와 일치하는지 확인합니다.
    function matchesProblemQuery(problem, query) {
      if (!problem) return false;
      if (!query) return true;
      return (problem.title || '').toLowerCase().includes(query) || String(problem.lessonId || '').includes(query);
    }

    // 검색어를 적용한 문제 목록을 반환합니다.
    function getMatchedProblems(query) {
      return problems.filter((problem) => matchesProblemQuery(problem, query));
    }

    // snapshot timestamp를 사이드바에 표시할 짧은 형식으로 바꿉니다.
    function formatSnapshotTime(value) {
      if (!value) return '-';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return value;
      return date.toLocaleString('ko-KR', {
        year: '2-digit',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    }

    // 현재 언어의 풀이 기록 rows를 구성합니다.
    function buildSolutionRows(problem) {
      if (!problem) return [];
      return (Array.isArray(problem.solutionHistory) ? problem.solutionHistory : [])
        .map((snapshot) => ({ problem, snapshot }))
        .sort((a, b) => {
          return String(b.snapshot.createdAt || '').localeCompare(String(a.snapshot.createdAt || ''));
        });
    }

    // 현재 언어가 아닌 다른 언어의 풀이 기록 rows를 구성합니다.
    function buildOtherSolutionRows(problem) {
      if (!problem) return [];
      return (Array.isArray(problem.otherSolutionHistory) ? problem.otherSolutionHistory : [])
        .map((snapshot) => ({ problem, snapshot, otherLanguage: true }))
        .sort((a, b) => {
          return String(b.snapshot.createdAt || '').localeCompare(String(a.snapshot.createdAt || ''));
        });
    }

    // 풀이 기록 목록을 현재 언어와 기타 언어 그룹으로 나눠 구성합니다.
    function buildAllSolutionRows(problem) {
      return buildSolutionRows(problem).concat(buildOtherSolutionRows(problem));
    }

    // snapshot에 표시할 언어 라벨을 보기 좋게 정리합니다.
    function formatLanguageLabel(language) {
      return language === 'java' ? 'Java' : language === 'cpp' ? 'C++' : language === 'python' ? 'Python' : (language || 'Unknown');
    }

    // 목록이 비었을 때 보여줄 placeholder row를 만듭니다.
    function createEmptyRow(text) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = text;
      return empty;
    }

    // 다음 렌더에 쓰이지 않는 cached row를 제거합니다.
    function pruneRowCache(cache, nextKeys) {
      for (const key of Array.from(cache.keys())) {
        if (!nextKeys.has(key)) {
          cache.delete(key);
        }
      }
    }

    // 빈 목록 상태를 하나의 placeholder row로 렌더링합니다.
    function renderEmptyList(container, cache, emptyText) {
      cache.clear();
      container.replaceChildren(createEmptyRow(emptyText));
    }

    // row DOM을 재사용하거나 없으면 새로 만들어 렌더 비용을 줄입니다.
    function getCachedRow(cache, key, factory) {
      let row = cache.get(key);
      if (!row) {
        row = factory();
        cache.set(key, row);
      }
      return row;
    }

    // key 기반 row cache를 사용해 문제/풀이 목록을 안정적으로 렌더링합니다.
    function renderCachedRows(container, items, cache, getKey, createRow, updateRow) {
      const nextKeys = new Set();
      const fragment = document.createDocumentFragment();
      items.forEach((item, index) => {
        const key = getKey(item, index);
        nextKeys.add(key);
        const row = getCachedRow(cache, key, createRow);
        updateRow(row, item, index);
        fragment.appendChild(row);
      });
      pruneRowCache(cache, nextKeys);
      container.replaceChildren(fragment);
    }

    // 문제 row cache에 사용할 안정적인 key를 만듭니다.
    function getProblemRowKey(problem, index) {
      return problem.problemDir || String(index);
    }

    // snapshot row cache에 사용할 안정적인 key를 만듭니다.
    function getSnapshotRowKey(row, index) {
      return (row.problem.problemDir || '') + '::' + (row.snapshot.path || index);
    }

    // 선택한 snapshot을 문제 경로와 snapshot 경로 조합으로 식별합니다.
    function getSnapshotSelectionKey(problemDir, snapshotPath) {
      return String(problemDir || '') + '::' + String(snapshotPath || '');
    }

    // 문제 목록에서 재사용할 row DOM 구조를 만듭니다.
    function createProblemRow() {
      const row = document.createElement('div');
      row.className = 'problem-row';
      row.innerHTML =
        '<div><div class="problem-title"><span class="problem-title-text"></span></div><div class="problem-meta"><span class="problem-lesson-id"></span><span class="problem-level"></span><span class="problem-history"></span></div></div>' +
        '<div class="problem-actions">' +
          '<label class="review-toggle"><input class="review-check" type="checkbox" /> 다시풀</label>' +
          '<button class="delete-problem" type="button" title="문제 삭제">삭제</button>' +
        '</div>';
      row._title = row.querySelector('.problem-title-text');
      row._lessonId = row.querySelector('.problem-lesson-id');
      row._level = row.querySelector('.problem-level');
      row._history = row.querySelector('.problem-history');
      row._review = row.querySelector('.review-check');
      return row;
    }

    // 문제 row DOM에 문제 제목, 상태, 액션 data를 반영합니다.
    function updateProblemRow(row, problem, index) {
      row.dataset.index = String(index);
      row.classList.toggle('current', Boolean(currentProblemDir && problem.problemDir === currentProblemDir));
      row._title.textContent = problem.title || '';
      const lessonId = problem.lessonId ? '#' + problem.lessonId : '';
      row._lessonId.textContent = lessonId;
      row._lessonId.hidden = !lessonId;
      const level = formatProblemLevel(problem.level);
      row._level.textContent = level;
      row._level.hidden = !level;
      const history = problem.solutionHistoryCount ? '이전풀이 ' + problem.solutionHistoryCount + '개' : '';
      row._history.textContent = history;
      row._history.hidden = !history;
      row._review.checked = Boolean(problem.review);
    }

    // Programmers 난이도 값을 작은 목록 배지 텍스트로 정리합니다.
    function formatProblemLevel(level) {
      const value = String(level || '').trim();
      if (!value) return '';
      return /^level\\s+/i.test(value) ? value.replace(/^level/i, 'Lv.') : 'Lv. ' + value;
    }

    // 풀이 기록 목록에서 재사용할 snapshot row DOM 구조를 만듭니다.
    function createSnapshotRow() {
      const row = document.createElement('div');
      row.className = 'snapshot-row';
      row.innerHTML =
        '<div><div class="snapshot-title"><span class="snapshot-title-text"></span></div><div class="snapshot-meta"></div></div>' +
        '<div class="problem-actions">' +
          '<button class="solution-action open-snapshot" type="button">열기</button>' +
          '<button class="delete-problem delete-snapshot" type="button">삭제</button>' +
        '</div>';
      row._title = row.querySelector('.snapshot-title-text');
      row._meta = row.querySelector('.snapshot-meta');
      return row;
    }

    // snapshot row DOM에 제목, 시각, 선택 상태를 반영합니다.
    function updateSnapshotRow(row, item, index) {
      const { problem, snapshot } = item;
      row.dataset.index = String(index);
      row.classList.toggle('current', selectedSnapshotKey === getSnapshotSelectionKey(problem.problemDir, snapshot.path));
      row._title.textContent = problem.title || '';
      row._meta.textContent =
        formatLanguageLabel(snapshot.language) +
        ' · ' + (snapshot.label || '이전 풀이') +
        ' · ' + formatSnapshotTime(snapshot.createdAt);
    }

    // 문제 목록을 검색 결과 기준으로 렌더링합니다.
    function renderList(container, visible, emptyText) {
      renderedProblems = visible;
      renderedSnapshots = [];
      snapshotRowCache.clear();
      otherSnapshotRowCache.clear();
      if (visible.length === 0) {
        renderEmptyList(container, problemRowCache, emptyText);
        return;
      }

      renderCachedRows(container, visible, problemRowCache, getProblemRowKey, createProblemRow, updateProblemRow);
    }

    // 현재 문제의 풀이 기록과 다른 언어 기록을 함께 렌더링합니다.
    function renderSolutionList(container, rows, otherRows, emptyText) {
      renderedProblems = [];
      renderedSnapshots = rows.concat(otherRows);
      problemRowCache.clear();
      if (rows.length === 0 && otherRows.length === 0) {
        otherSnapshotRowCache.clear();
        renderEmptyList(container, snapshotRowCache, emptyText);
        return;
      }

      const fragment = document.createDocumentFragment();
      if (rows.length > 0) {
        const currentContainer = document.createElement('div');
        renderCachedRows(currentContainer, rows, snapshotRowCache, getSnapshotRowKey, createSnapshotRow, updateSnapshotRow);
        fragment.append(...Array.from(currentContainer.childNodes));
      } else {
        snapshotRowCache.clear();
        fragment.appendChild(createEmptyRow('현재 언어에 저장된 풀이 기록이 없습니다.'));
      }

      if (otherRows.length > 0) {
        const details = document.createElement('details');
        details.className = 'snapshot-other';
        details.open = otherRows.some((row) => selectedSnapshotKey === getSnapshotSelectionKey(row.problem.problemDir, row.snapshot.path));
        const summary = document.createElement('summary');
        summary.textContent = '다른 언어 풀이 ' + otherRows.length + '개';
        const otherList = document.createElement('div');
        otherList.className = 'snapshot-other-list';
        renderCachedRows(
          otherList,
          otherRows,
          otherSnapshotRowCache,
          getSnapshotRowKey,
          createSnapshotRow,
          (row, item, index) => updateSnapshotRow(row, item, rows.length + index)
        );
        details.append(summary, otherList);
        fragment.appendChild(details);
      } else {
        otherSnapshotRowCache.clear();
      }

      container.replaceChildren(fragment);
    }

    // 문제 목록과 현재 문제의 풀이 기록 목록 전체를 다시 그립니다.
    function renderProblems() {
      const filter = document.querySelector('input[name="problemFilter"]:checked')?.value || 'all';
      const query = problemSearch.value.trim().toLowerCase();
      const matched = getMatchedProblems(query);
      if (filter === 'solutions') {
        const currentMatchesQuery = matchesProblemQuery(currentProblem, query);
        const rows = currentMatchesQuery ? buildSolutionRows(currentProblem) : [];
        const otherRows = currentMatchesQuery ? buildOtherSolutionRows(currentProblem) : [];
        const emptyText = !currentProblem
          ? '현재 열린 문제가 없습니다.'
          : query
            ? '현재 문제와 검색어가 일치하지 않습니다.'
            : '현재 문제에 저장된 풀이 기록이 없습니다.';
        renderSolutionList(problemList, rows, otherRows, emptyText);
        updatePaneSummaries();
        return;
      }

      const visible = filter === 'review' ? matched.filter((problem) => problem.review) : matched;
      const emptyText = query
        ? '검색 결과가 없습니다.'
        : filter === 'review'
          ? '다시 풀 문제가 없습니다.'
          : 'Programmers 폴더에 문제가 없습니다.';
      renderList(problemList, visible, emptyText);
      updatePaneSummaries();
    }

    // 현재 열린 문제 row가 목록 안에서 보이도록 스크롤합니다.
    function scrollCurrentProblemIntoView() {
      const currentRow = problemList.querySelector('.problem-row.current');
      if (!currentRow) return;
      currentRow.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    // 선택한 snapshot row가 풀이 기록 목록 안에서 보이도록 스크롤합니다.
    function scrollSelectedSnapshotIntoView() {
      const currentRow = problemList.querySelector('.snapshot-row.current');
      if (!currentRow) return;
      const details = currentRow.closest('details');
      if (details) {
        details.open = true;
      }
      currentRow.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    // 저장해 둔 문제 목록 스크롤 위치를 다음 렌더 뒤에 복원합니다.
    function restoreProblemListScrollTop() {
      if (pendingProblemListScrollTop === undefined) return;
      problemList.scrollTop = pendingProblemListScrollTop;
      pendingProblemListScrollTop = undefined;
    }

    // 스크롤 중 과도한 저장을 피하도록 위치 저장을 debounce합니다.
    function scheduleProblemListScrollSave() {
      if (!sidebarStateReady) return;
      if (scrollSaveTimer) {
        clearTimeout(scrollSaveTimer);
      }
      scrollSaveTimer = setTimeout(() => {
        scrollSaveTimer = undefined;
        saveSidebarState();
      }, 500);
    }

    // 검색 입력 중 과도한 DOM 갱신을 피하도록 목록 렌더를 예약합니다.
    function scheduleRenderProblems() {
      if (searchRenderTimer) {
        clearTimeout(searchRenderTimer);
      }
      searchRenderTimer = setTimeout(() => {
        searchRenderTimer = undefined;
        renderProblems();
      }, 120);
    }`;
}

module.exports = {
  buildSidebarClientListScript,
};

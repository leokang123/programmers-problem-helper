// Sidebar Webview CSS를 HTML 조립 코드와 분리해 관리합니다.
function buildSidebarStyles() {
  return `    html, body { height: 100%; margin: 0; padding: 0; overflow: hidden; }
    body { color: var(--vscode-foreground); font-family: var(--vscode-font-family); }
    label { display: block; margin-bottom: 6px; font-size: 12px; color: var(--vscode-descriptionForeground); }
    input, textarea { width: 100%; box-sizing: border-box; padding: 6px 7px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); }
    textarea { min-height: 52px; resize: vertical; font-family: var(--vscode-editor-font-family); font-size: 12px; }
    button { width: 100%; margin-top: 6px; padding: 6px 7px; border: 0; background: var(--vscode-button-background); color: var(--vscode-button-foreground); cursor: pointer; }
    button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    button:hover { background: var(--vscode-button-hoverBackground); }
    .app { height: 100%; box-sizing: border-box; display: grid; grid-template-rows: auto minmax(0, 58fr) minmax(0, 42fr); gap: 4px; padding: 4px; overflow: hidden; }
    .app.tests-collapsed { grid-template-rows: auto auto minmax(0, 1fr); }
    .app.list-collapsed { grid-template-rows: auto minmax(0, 1fr) auto; }
    .app.tests-collapsed.list-collapsed { grid-template-rows: auto auto auto; align-content: start; }
    .pane { min-height: 0; display: flex; flex-direction: column; background: var(--vscode-sideBar-background); }
    .pane + .pane { border-top: 1px solid var(--vscode-panel-border); }
    .pane-title { flex: 0 0 auto; padding: 5px 2px; font-size: 12px; font-weight: 600; color: var(--vscode-foreground); }
    .toggle-title { display: flex; align-items: center; gap: 6px; width: 100%; margin: 0; border: 0; background: transparent; color: var(--vscode-foreground); text-align: left; cursor: pointer; }
    .toggle-title:hover { background: var(--vscode-list-hoverBackground); }
    .toggle-icon { width: 10px; color: var(--vscode-descriptionForeground); }
    .toggle-label { flex: 1 1 auto; min-width: 0; }
    .toggle-summary { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; font-weight: 400; color: var(--vscode-descriptionForeground); }
    .collapsed-badge { display: none; flex: 0 0 auto; padding: 1px 5px; border: 1px solid var(--vscode-panel-border); border-radius: 2px; font-size: 10px; font-weight: 400; color: var(--vscode-descriptionForeground); }
    .pane-body { min-height: 0; flex: 1 1 auto; overflow: auto; padding: 2px; box-sizing: border-box; }
    .top-pane .pane-body { overflow: visible; }
    #testsPane .pane-body { display: flex; flex-direction: column; overflow: hidden; padding: 0; }
    .pane.collapsed { overflow: hidden; }
    .pane.collapsed .pane-body { display: none; }
    .pane-body[hidden] { display: none !important; }
    .pane.collapsed .collapsed-badge { display: inline-block; }
    #listPane .pane-body { display: flex; flex-direction: column; overflow: hidden; }
    .section-title { margin-bottom: 5px; font-size: 12px; font-weight: 600; color: var(--vscode-foreground); }
    .section { margin-bottom: 8px; }
    .section:last-child { margin-bottom: 0; }
    .open-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; align-items: stretch; }
    .open-row button { width: auto; min-width: 82px; margin-top: 0; }
    .current-actions { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; margin-top: 6px; }
    .current-actions button { margin-top: 0; }
    .timer-panel { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; justify-content: center; margin-top: 6px; padding: 6px 0 0; border-top: 1px solid var(--vscode-panel-border); }
    .timer-display { flex: 1 1 98px; min-width: 92px; font-variant-numeric: tabular-nums; font-size: 12px; color: var(--vscode-descriptionForeground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center; }
    .timer-panel.timer-paused .timer-display { color: var(--vscode-textLink-foreground); }
    .timer-panel.timer-warning .timer-display { color: var(--vscode-editorWarning-foreground); font-weight: 600; }
    .timer-panel.timer-over .timer-display { color: var(--vscode-errorForeground); font-weight: 600; }
    .timer-controls { flex: 0 1 146px; display: flex; gap: 3px; align-items: center; min-width: 140px; }
    .timer-target { flex: 0 0 54px; width: auto; min-width: 54px; box-sizing: border-box; padding: 5px 4px; border: 1px solid var(--vscode-input-border); background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); font-size: 12px; }
    .timer-buttons { flex: 1 1 84px; display: flex; gap: 3px; align-items: center; min-width: 82px; }
    .timer-buttons button { flex: 1 1 0; width: auto; min-width: 39px; margin-top: 0; padding: 5px 4px; white-space: nowrap; }
    @media (max-width: 244px) {
      .timer-display { flex: 1 0 100%; min-width: 0; }
      .timer-controls { flex: 1 1 100%; }
    }
    .list-actions { flex: 0 0 auto; display: flex; gap: 8px; align-items: center; margin-bottom: 5px; flex-wrap: wrap; }
    .filter { display: flex; gap: 6px; align-items: center; margin: 0; font-size: 12px; color: var(--vscode-foreground); }
    .filter input { width: auto; margin: 0; }
    .search { flex: 1 1 100%; min-width: 0; }
    .refresh { width: auto; min-width: 30px; margin: 0 0 0 auto; padding: 3px 7px; }
    button:disabled { opacity: 0.55; cursor: default; }
    .problem-list { flex: 1 1 auto; min-height: 0; overflow-x: hidden; overflow-y: auto; border-top: 1px solid var(--vscode-panel-border); }
    .problem-row { box-sizing: border-box; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; align-items: center; width: 100%; padding: 7px 0; border-bottom: 1px solid var(--vscode-panel-border); cursor: pointer; }
    .problem-row:hover { background: var(--vscode-list-hoverBackground); }
    .problem-row.current { padding: 7px 2px; border-left: 3px solid var(--vscode-focusBorder); background: var(--vscode-list-activeSelectionBackground); }
    .problem-row.current .problem-title { color: var(--vscode-list-activeSelectionForeground); font-weight: 600; }
    .problem-title { font-size: 12px; line-height: 1.35; color: var(--vscode-foreground); word-break: break-word; }
    .problem-meta { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; margin-top: 2px; font-size: 11px; color: var(--vscode-descriptionForeground); }
    .problem-lesson-id { flex: 0 0 auto; font-size: 10px; line-height: 1.45; color: var(--vscode-descriptionForeground); opacity: 0.82; }
    .problem-lesson-id[hidden] { display: none; }
    .problem-level { flex: 0 0 auto; padding: 0 2px; font-size: 10px; line-height: 1.45; color: var(--vscode-descriptionForeground); }
    .problem-level[hidden] { display: none; }
    .problem-history[hidden] { display: none; }
    .problem-actions { display: flex; gap: 6px; align-items: center; }
    .review-toggle { display: flex; gap: 4px; align-items: center; margin: 0; font-size: 11px; color: var(--vscode-descriptionForeground); }
    .review-toggle input { width: auto; margin: 0; }
    .solution-action { width: auto; margin: 0; padding: 2px 6px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); font-size: 11px; }
    .solution-action:hover { background: var(--vscode-button-hoverBackground); color: var(--vscode-button-foreground); }
    .snapshot-row { box-sizing: border-box; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; align-items: center; width: 100%; padding: 7px 0; border-bottom: 1px solid var(--vscode-panel-border); cursor: pointer; }
    .snapshot-row:hover { background: var(--vscode-list-hoverBackground); }
    .snapshot-row.current { padding: 7px 2px; border-left: 3px solid var(--vscode-focusBorder); background: var(--vscode-list-activeSelectionBackground); }
    .snapshot-row.current .snapshot-title { color: var(--vscode-list-activeSelectionForeground); font-weight: 600; }
    .snapshot-title { font-size: 12px; line-height: 1.35; color: var(--vscode-foreground); word-break: break-word; }
    .snapshot-meta { margin-top: 2px; font-size: 11px; color: var(--vscode-descriptionForeground); }
    .snapshot-other { border-bottom: 1px solid var(--vscode-panel-border); }
    .snapshot-other > summary { cursor: pointer; padding: 8px 0; font-size: 11px; color: var(--vscode-descriptionForeground); user-select: none; }
    .snapshot-other-list { padding-left: 8px; border-left: 1px solid var(--vscode-panel-border); }
    .delete-problem { width: auto; margin: 0; padding: 2px 6px; background: transparent; color: var(--vscode-descriptionForeground); font-size: 12px; }
    .delete-problem:hover { background: var(--vscode-list-hoverBackground); color: var(--vscode-errorForeground); }
    .empty { padding: 9px 0; font-size: 12px; color: var(--vscode-descriptionForeground); line-height: 1.4; }
    .test-actions { flex: 0 0 auto; padding: 2px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); }
    .test-actions-grid { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: 6px; }
    .test-actions-grid button { margin-top: 0; }
    .custom-actions { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; align-items: center; }
    .custom-actions button { margin-top: 0; }
    #saveCustomTests { min-width: 64px; }
    .tests-content { min-height: 0; flex: 1 1 auto; overflow: auto; padding: 8px 2px 2px; box-sizing: border-box; }
    .test-card { margin-top: 8px; padding: 8px; border: 1px solid var(--vscode-panel-border); background: var(--vscode-editor-background); }
    .test-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; font-size: 12px; color: var(--vscode-descriptionForeground); }
    .remove { width: auto; margin: 0; padding: 3px 7px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .status-slot { height: 84px; margin-top: 5px; }
    .status { box-sizing: border-box; max-height: 84px; padding: 5px 6px; border: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBarSectionHeader-background); white-space: pre-wrap; overflow: auto; overflow-wrap: anywhere; word-break: break-word; font-size: 12px; color: var(--vscode-foreground); line-height: 1.25; }
    .status.ready { border-color: var(--vscode-testing-iconPassed); }
    .status.error { border-color: var(--vscode-testing-iconFailed); }
    .status.running { border-color: var(--vscode-progressBar-background); }
    .hint { margin-top: 6px; font-size: 11px; line-height: 1.4; color: var(--vscode-descriptionForeground); }`;
}

module.exports = {
  buildSidebarStyles,
};

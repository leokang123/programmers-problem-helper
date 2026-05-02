const {
  buildSidebarClientInteractionScript,
} = require("./sidebarClientInteractionScript");
const {
  buildSidebarClientListScript,
} = require("./sidebarClientListScript");
const {
  buildSidebarClientStateScript,
} = require("./sidebarClientStateScript");

// Sidebar Webview 안에서 실행되는 client script를 HTML 조립 코드와 분리해 관리합니다.
function buildSidebarClientScript() {
  return [
    buildSidebarClientStateScript(),
    buildSidebarClientListScript(),
    buildSidebarClientInteractionScript(),
  ].join("\n");
}

module.exports = {
  buildSidebarClientScript,
};

// Toolbar icon dabane par side panel khulta hai.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "nf-research",
    title: 'Niche Finder: "%s" research karein',
    contexts: ["selection"],
  });
});

// Page par text select karke right-click → side panel us keyword ke saath khulta hai.
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "nf-research" || !info.selectionText) return;
  // sidePanel.open user gesture ke andar foran call hona chahiye, is liye pehle.
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  chrome.storage.session.set({ pendingKeyword: info.selectionText.trim().slice(0, 80), pendingAt: Date.now() });
});

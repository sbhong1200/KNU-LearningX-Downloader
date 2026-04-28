// background.js — KNU LearningX Downloader

// lcms.knu.ac.kr/em/{id} 패턴 감지
const VIDEO_PATTERN = /^https:\/\/lcms\.knu\.ac\.kr\/em\/[a-zA-Z0-9]+/;

// tabId -> Set of video URLs
const videoMap = {};

// 영상 요청 감지
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const { url, tabId } = details;
    if (tabId < 0) return;
    if (VIDEO_PATTERN.test(url)) {
      if (!videoMap[tabId]) videoMap[tabId] = new Set();
      videoMap[tabId].add(url);
      console.log(`[background] video detected for tab ${tabId}: ${url}`);
    }
  },
  { urls: ["*://lcms.knu.ac.kr/em/*"] }
);

// 탭 이동 시 초기화
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' && videoMap[tabId]) {
    delete videoMap[tabId];
  }
});

// 탭 닫힘 시 정리
chrome.tabs.onRemoved.addListener((tabId) => {
  if (videoMap[tabId]) delete videoMap[tabId];
});

// 메시지 처리
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 감지된 영상 URL 목록 반환
  if (request.action === 'getVideos') {
    const urls = videoMap[request.tabId]
      ? Array.from(videoMap[request.tabId])
      : [];
    sendResponse({ videos: urls });
    return;
  }

  // 메타데이터 XML fetch
  if (request.action === 'getMetadata') {
    const id = request.id;
    const url = `https://lcms.knu.ac.kr/viewer/ssplayer/uniplayer_support/content.php?content_id=${id}`;
    fetch(url, { headers: { 'Referer': 'https://lcms.knu.ac.kr/' } })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then(text => sendResponse({ xml: text }))
      .catch(err => sendResponse({ error: err.message }));
    return true; // async
  }

  // 다운로드 요청 (chrome.downloads 사용, 외부 서버 불필요)
  if (request.action === 'download') {
    chrome.downloads.download({
      url: request.url,
      filename: request.filename,
      saveAs: false
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ downloadId });
      }
    });
    return true; // async
  }
});

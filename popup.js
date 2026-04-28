// popup.js — KNU LearningX Downloader
const view = document.querySelector('#wrapper');

const ERRORS = {
  NOT_LEARNINGX: 'KNU Canvas 강의 페이지가 아닙니다',
  NO_VIDEOS:     '강의 영상 없음 (영상을 먼저 재생해주세요)',
  FETCH_ERROR:   '강의 정보를 가져오는 중 오류가 발생했습니다',
};

const videoMetadataCache = new Map();

(async () => {
  try {
    const tab = await getActiveTab();
    if (!tab) { showError('탭 정보를 가져올 수 없습니다'); return; }

    const isKNU = tab.url && (
      tab.url.includes('canvas.knu.ac.kr') ||
      tab.url.includes('lcms.knu.ac.kr')
    );
    if (!isKNU) { view.innerHTML = ERRORS.NOT_LEARNINGX; return; }

    await scanForVideos(tab.id);
  } catch (err) {
    showError(`오류: ${err.message}`);
  }
})();

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function scanForVideos(tabId) {
  const response = await chrome.runtime.sendMessage({ action: 'getVideos', tabId });
  const videos = response.videos || [];
  if (videos.length === 0) {
    view.innerHTML = ERRORS.NO_VIDEOS;
    return;
  }
  await listVideos(videos);
}

async function listVideos(videos) {
  view.innerHTML = '';
  const list = document.createElement('div');
  list.className = 'video-list';
  view.appendChild(list);

  const loading = document.createElement('div');
  loading.className = 'loading';
  loading.textContent = '강의 정보 불러오는 중...';
  list.appendChild(loading);

  for (const url of videos) {
    await processVideo(url, list);
  }

  loading.remove();

  if (list.children.length === 0) {
    list.innerHTML = `<div class="error">${ERRORS.NO_VIDEOS}</div>`;
  }
}

async function processVideo(videoUrl, container) {
  try {
    const id = videoUrl.split('?')[0].split('/').pop();

    if (videoMetadataCache.has(id)) {
      addVideoItem(videoMetadataCache.get(id), container);
      return;
    }

    const response = await new Promise(resolve =>
      chrome.runtime.sendMessage({ action: 'getMetadata', id }, resolve)
    );

    if (response.error) throw new Error(response.error);
    if (!response.xml)  throw new Error('메타데이터 XML 없음');

    const dom = new DOMParser().parseFromString(response.xml, 'text/xml');

    let titleEl = dom.querySelector('content_metadata title') || dom.querySelector('title');
    if (!titleEl) throw new Error('title 요소 없음');
    const lectName = titleEl.textContent.trim();

    const contentTypeEl = dom.querySelector('content_playing_info content_type');
    const contentType = contentTypeEl?.textContent.trim() || '';

    let videoSrcUrl, ext;

    if (contentType.toLowerCase() !== 'upf') {
      // 신형 포맷
      const cpi = dom.querySelector('content_playing_info');
      const mediaUriEl =
        Array.from(cpi.getElementsByTagName('media_uri')).find(el => el.hasAttribute('auth_value'))
        || cpi.getElementsByTagName('media_uri')[0];
      if (!mediaUriEl) throw new Error('media_uri 없음');
      const authValue = mediaUriEl.getAttribute('auth_value');
      videoSrcUrl = mediaUriEl.textContent.trim() + (authValue ? '?token=' + authValue : '');
      ext = mediaUriEl.textContent.trim().split('.').pop();
    } else {
      // 구형 UPF 포맷 (KNU)
      const mainMediaEl = dom.querySelector('main_media');
      if (!mainMediaEl) throw new Error('main_media 요소 없음');
      const mediaFile = mainMediaEl.textContent.trim();

      const allMediaUris = Array.from(dom.querySelectorAll('media_uri'));
      const mediaUriEl =
        allMediaUris.find(el => el.getAttribute('method') === 'progressive' && el.getAttribute('target') === 'all')
        || allMediaUris.find(el => el.getAttribute('method') === 'progressive')
        || allMediaUris[0];
      if (!mediaUriEl) throw new Error('media_uri 요소 없음');

      const mediaUri = mediaUriEl.textContent.trim();
      const authValue = mainMediaEl.getAttribute('auth_value');
      const base = mediaUri.replace('[MEDIA_FILE]', mediaFile);
      videoSrcUrl = authValue ? base + '?token=' + authValue : base;
      ext = mediaFile.split('.').pop().trim();

      console.log('[popup] UPF resolved URL:', videoSrcUrl);
    }

    const metadata = { lectName, url: videoSrcUrl, ext };
    videoMetadataCache.set(id, metadata);
    addVideoItem(metadata, container);

  } catch (err) {
    console.error('processVideo error:', err);
    const errEl = document.createElement('div');
    errEl.className = 'error';
    errEl.textContent = `오류: ${err.message}`;
    container.appendChild(errEl);
  }
}

function addVideoItem(metadata, container) {
  const { lectName, url, ext } = metadata;

  const item = document.createElement('div');
  item.className = 'video-item';

  const link = document.createElement('a');
  link.href = '#';
  link.textContent = lectName;
  link.className = 'video-link';

  const status = document.createElement('div');
  status.className = 'download-status';

  link.onclick = async (e) => {
    e.preventDefault();
    status.textContent = '파일 받는 중... (잠시 기다려주세요)';
    status.className = 'download-status';
    link.style.pointerEvents = 'none';

    try {
      // Referer를 lcms.knu.ac.kr로 설정하여 CDN 인증 통과
      const res = await fetch(url, {
        referrer: 'https://lcms.knu.ac.kr/',
        referrerPolicy: 'unsafe-url'
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const filename = `${lectName}.${ext}`.replace(/[\\/:*?"<>|]/g, '_');

      await chrome.downloads.download({ url: blobUrl, filename, saveAs: false });
      status.textContent = '다운로드 시작됨 ✓';
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    } catch (err) {
      status.textContent = `오류: ${err.message}`;
      status.className = 'download-status error';
    } finally {
      link.style.pointerEvents = '';
    }
  };

  item.appendChild(link);
  item.appendChild(status);
  container.appendChild(item);
}

function showError(msg) {
  view.innerHTML = `<div class="error">${msg}</div>`;
}

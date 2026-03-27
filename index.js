/**
 * @name Tidal Batch Downloader
 * @author Antigravity
 * @version 1.0.0
 * @description 재생목록 일괄 다운로드 커스텀 플러그인
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');

class TidalBatchDownloader {
    constructor() {
        // 바탕화면에 바로 다운로드 받도록 기본 폴더 지정
        this.savePath = path.join(os.homedir(), 'Desktop', 'TidalDownloads');
        if (!fs.existsSync(this.savePath)) {
            fs.mkdirSync(this.savePath, { recursive: true });
        }
        
        this.queue = [];
        this.isDownloading = false;
        
        // 플러그인용 UI DOM 참조 보관
        this.ui = {
            widget: null,
            trackInfo: null,
            progressBar: null,
            speedText: null,
            percentText: null,
            queueList: null
        };
        
        this.initUI();
    }

    /**
     * 1. 다운로드 매니저 플로팅 위젯을 화면 우측 하단에 생성
     */
    initUI() {
        const widget = document.createElement('div');
        widget.id = 'tidal-batch-queue-widget';
        widget.innerHTML = `
            <div id="tidal-batch-queue-header">
                <span>🎵 다운로드 매니저</span>
                <span id="tbd-close" style="cursor:pointer; font-size: 16px; color:#aaa;">&times;</span>
            </div>
            <div id="tidal-batch-queue-body">
                <div class="tbd-track-info" id="tbd-track-name">대기 중...</div>
                <div class="tbd-progress-container">
                    <div class="tbd-progress-bar" id="tbd-progress-fill"></div>
                </div>
                <div class="tbd-stats">
                    <span id="tbd-percent">0%</span>
                    <span id="tbd-speed">0.00 MB/s</span>
                </div>
                <div class="tbd-queue-list" id="tbd-queue-list">대기열이 비어있습니다.</div>
            </div>
        `;
        document.body.appendChild(widget);

        this.ui.widget = widget;
        this.ui.trackInfo = document.getElementById('tbd-track-name');
        this.ui.progressBar = document.getElementById('tbd-progress-fill');
        this.ui.percentText = document.getElementById('tbd-percent');
        this.ui.speedText = document.getElementById('tbd-speed');
        this.ui.queueList = document.getElementById('tbd-queue-list');

        // 닫기 버튼 이벤트
        document.getElementById('tbd-close').onclick = () => {
            widget.style.display = 'none';
        };
    }

    showWidget() {
        if (this.ui.widget) this.ui.widget.style.display = 'flex';
    }

    /**
     * 2. UI 화면 갱신: 현재 남은 대기열(Queue) 상태를 리스트에 출력
     */
    updateQueueUI() {
        if (this.queue.length === 0) {
            this.ui.queueList.innerHTML = "대기열이 비어있습니다.";
        } else {
            this.ui.queueList.innerHTML = this.queue.map(
                (t, idx) => `<div class="tbd-queue-item">${idx + 1}. ${t.title}</div>`
            ).join('');
        }
    }

    /**
     * 3. 큐에 트랙 추가
     */
    addTrackToQueue(trackInfo) {
        this.queue.push(trackInfo);
        this.updateQueueUI();
        this.showWidget(); // 작업이 추가되면 창을 띄움
        
        if (!this.isDownloading) {
            this.processQueue(); // 큐가 쉬는 중이면 비동기 시스템 구동
        }
    }

    /**
     * 4. 비동기 백엔드 컨트롤 루프: 큐에서 하나씩 꺼내고 딜레이 부여
     */
    async processQueue() {
        if (this.queue.length === 0) {
            this.isDownloading = false;
            this.ui.trackInfo.innerText = "✨ 모든 작업이 완료되었습니다.";
            this.ui.progressBar.style.width = "0%";
            this.ui.speedText.innerText = "-";
            this.ui.percentText.innerText = "-";
            return;
        }

        this.isDownloading = true;
        
        // 큐의 첫번째 요소 꺼내기
        const currentTrack = this.queue.shift();
        this.updateQueueUI();
        
        this.ui.trackInfo.innerText = `⬇️ 다운로드 중: ${currentTrack.title}`;
        this.ui.progressBar.style.width = "0%";

        try {
            // [더미 로직] 실제 앱이라면 이 위치에서 getTidalStreamUrl API를 호출하여 세션 인증을 진행해야 함.
            const streamUrl = await this.getTidalStreamUrl(currentTrack.id);
            await this.downloadFile(streamUrl, currentTrack);
        } catch (error) {
            console.error(error);
            this.ui.trackInfo.innerText = `🚨 오류 발생: ${currentTrack.title}`;
        }

        // TIDAL 단기 밴 방지를 위해 완료 후 2.5초 휴식
        await new Promise(r => setTimeout(r, 2500));
        
        // 재귀 호출로 다음 곡 진행
        this.processQueue();
    }

    /**
     * 5. 파일 다운로드 스트림 및 속도 측정 코어 로직
     */
    downloadFile(url, trackInfo) {
        return new Promise((resolve, reject) => {
            // 제목의 불법 문자열 치환
            const safeTitle = trackInfo.title.replace(/[\/\\?%*:|"<>]/g, '-');
            const dest = path.join(this.savePath, `${safeTitle}.flac`);
            const file = fs.createWriteStream(dest);

            https.get(url, (response) => {
                // 다운로드 파일명 및 헤더 크기
                const totalBytes = parseInt(response.headers['content-length'], 10) || 5242880; // 5MB 고정 (더미용)
                let downloadedBytes = 0;
                let startTime = Date.now();

                response.on('data', (chunk) => {
                    downloadedBytes += chunk.length;
                    
                    const elapsedTime = (Date.now() - startTime) / 1000;
                    let speed = elapsedTime > 0 ? (downloadedBytes / 1024 / 1024) / elapsedTime : 0;
                    const progress = Math.min(((downloadedBytes / totalBytes) * 100), 100).toFixed(1);
                    
                    // UI 실시간 그래프 갱신
                    this.ui.progressBar.style.width = `${progress}%`;
                    this.ui.percentText.innerText = `${progress}%`;
                    this.ui.speedText.innerText = `${speed.toFixed(2)} MB/s`;
                });

                response.pipe(file);

                file.on('finish', () => {
                    file.close();
                    resolve();
                });
            }).on('error', (err) => {
                fs.unlink(dest, () => {});
                reject(err);
            });
        });
    }

    /**
     * 6. 실전 API 연동: 앱 내부의 유효 토큰(Session)을 꺼내어 Tidal의 숨겨진 PlaybackInfo 요청
     */
    async getTidalStreamUrl(trackId) {
        try {
            // 1. TIDAL 앱에 이미 로그인된 상태이므로 로컬 스토리지에서 세션(Token)을 훔쳐옴
            const sessionStr = window.localStorage.getItem('_TIDAL_activeSession');
            let accessToken = "";
            let clientId = "pk_1234567890"; // 기본 fallback 클라이언트 ID
            
            if (sessionStr) {
                const sessionObj = JSON.parse(sessionStr);
                accessToken = sessionObj.oauthAccessToken || sessionObj.accessToken || sessionObj.token;
                if (sessionObj.clientId) clientId = sessionObj.clientId;
            }

            if (!accessToken) throw new Error("계정 인증 토큰(AccessToken)을 찾을 수 없습니다.");

            // 2. Highest Quality(FLAC) 원본 스트림 주소 및 암호화 매니페스트 요청
            const apiUrl = `https://api.tidal.com/v1/tracks/${trackId}/playbackinfo?audioquality=HI_RES&playbackmode=STREAM&assetpresentation=FULL`;
            
            const response = await fetch(apiUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'x-tidal-token': clientId
                }
            });

            if (!response.ok) throw new Error(`Tidal API 거부: 상태 코드 ${response.status}`);
            
            const data = await response.json();

            // 3. Tidal 서버가 주는 응답 파싱 (서버 측 암호화 매니페스트 Base64 해독)
            if (data && data.manifest) {
                const decodedManifest = JSON.parse(atob(data.manifest));
                if (decodedManifest.urls && decodedManifest.urls.length > 0) {
                    return decodedManifest.urls[0]; // 순수 오디오 청크 URL 반환
                }
            } else if (data && data.urls && data.urls.length > 0) {
                return data.urls[0];
            }
            
            throw new Error("유효한 오디오 스트림 매니페스트가 없습니다.");
        } catch (error) {
            console.error(`[Stream Extractor Error] 트랙 ID ${trackId}:`, error);
            throw error;
        }
    }
}

// ----------------------------------------------------
// Neptune 플러그인 시스템 엔트리 (Entry Points)
// ----------------------------------------------------

let batchDownloader;
let domObserver;

export function load() {
    console.log("🌊 Tidal Batch Downloader Plugin Loaded");
    
    // 1. CSS 인젝트 (웹팩/해시가 아닌 순수 플러그인을 가정)
    const styleEl = document.createElement('style');
    styleEl.id = 'tbd-custom-style';
    styleEl.innerHTML = `
#tidal-batch-queue-widget { position: fixed; bottom: 30px; right: 30px; width: 320px; background-color: #121212; border: 1px solid #333; border-radius: 8px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6); z-index: 99999; color: #fff; font-family: 'Inter', -apple-system, sans-serif; display: none; flex-direction: column; overflow: hidden; }
#tidal-batch-queue-header { background-color: #000; padding: 12px 16px; font-weight: 600; font-size: 14px; border-bottom: 1px solid #333; display: flex; justify-content: space-between; align-items: center; }
#tidal-batch-queue-body { padding: 16px; }
.tbd-track-info { font-size: 13px; margin-bottom: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #e1e1e1; }
.tbd-progress-container { width: 100%; height: 8px; background-color: #333; border-radius: 4px; overflow: hidden; margin-bottom: 8px; }
.tbd-progress-bar { height: 100%; background-color: #00FFFF; width: 0%; transition: width 0.2s ease-out; }
.tbd-stats { display: flex; justify-content: space-between; font-size: 12px; color: #999; }
.tbd-queue-list { margin-top: 14px; border-top: 1px solid #333; padding-top: 10px; font-size: 12px; color: #888; max-height: 120px; overflow-y: auto; }
.tbd-queue-item { padding: 4px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tbd-download-btn { background-color: rgba(0, 255, 255, 0.1); color: #00FFFF; border: 1px solid #00FFFF; border-radius: 6px; padding: 8px 16px; font-size: 13px; font-weight: 500; cursor: pointer; margin-left: 16px; transition: all 0.2s ease-in-out; display: flex; align-items: center; }
.tbd-download-btn:hover { background-color: rgba(0, 255, 255, 0.2); box-shadow: 0 0 10px rgba(0, 255, 255, 0.3); }`;
    document.head.appendChild(styleEl);

    // 2. 백엔드 매니저 초기화
    batchDownloader = new TidalBatchDownloader();

    // 3. 페이지 변화 실시간 감지하여 [재생목록 다운로드 버튼]을 주입 (MutationObserver)
    domObserver = new MutationObserver((mutations) => {
        // 타이달의 기본 액션바 영역 탐색 (플레이리스트/앨범 최상단) 
        // 주의: data-test 클래스는 Tidal 배포 버전에 따라 달라지므로, 범용적으로 querySelector 사용
        const actionBar = document.querySelector('[class*="mediaActions"]'); 
        
        if (actionBar && !document.getElementById('btn-batch-download')) {
            const btn = document.createElement('button');
            btn.id = 'btn-batch-download';
            btn.className = 'tbd-download-btn';
            btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:8px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> 전체 다운로드`;
            
            btn.onclick = () => {
                // 실전용 파싱: 화면에 실제로 렌더링된 재생목록(Table)의 트랙 요소 배열을 동적으로 추출
                // 주의: Tidal UI 버전에 따라 'data-test' 값이나 CSS 선택자 호환성 변경이 발생할 수 있습니다!
                const trackElements = document.querySelectorAll('div[data-test="tracklist-row"]');
                
                if (trackElements.length === 0) {
                    alert("🚨 화면에서 다운로드할 트랙을 찾을 수 없습니다. (스크롤을 내려 전체 트랙을 로드해주세요)");
                    return;
                }

                const parsedTracks = [];
                trackElements.forEach((el) => {
                    // 항목 안에서 트랙 ID와 제목이 담긴 텍스트 파싱
                    const trackIdMatch = el.innerHTML.match(/track\/(\d+)/); 
                    const titleEl = el.querySelector('[data-test="table-row-title"]');
                    
                    if (trackIdMatch && titleEl) {
                        parsedTracks.push({
                            id: trackIdMatch[1],
                            title: titleEl.innerText.trim()
                        });
                    }
                });
                
                if (parsedTracks.length > 0) {
                    alert(`✅ 화면에서 ${parsedTracks.length}개의 트랙을 찾아 대기열(Queue)에 추가합니다.`);
                    parsedTracks.forEach((t) => {
                        batchDownloader.addTrackToQueue(t);
                    });
                } else {
                    alert("🚨 트랙 메타데이터 파싱에 실패했습니다. (Tidal의 렌더링 구조 변경 가능성 우려)");
                }
            };
            
            // 맨 앞에 버튼 주입
            actionBar.prepend(btn);
        }
    });

    // 감지 시작
    domObserver.observe(document.body, { childList: true, subtree: true });
}

export function unload() {
    // 플러그인 비활성화 시 모든 쓰레기 객체들 제거
    if (batchDownloader && batchDownloader.ui.widget) {
        batchDownloader.ui.widget.remove();
    }
    if (domObserver) {
        domObserver.disconnect();
    }
    const btn = document.getElementById('btn-batch-download');
    if (btn) btn.remove();
    
    const styleEl = document.getElementById('tbd-custom-style');
    if (styleEl) styleEl.remove();
    
    console.log("🌊 Tidal Batch Downloader Unloaded");
}


        const video = document.getElementById('input_video'), canvas = document.getElementById('output_canvas'), ctx = canvas.getContext('2d');
        const aMain = document.getElementById('alert-main'), aSub = document.getElementById('alert-sub'), cScreen = document.getElementById('calib-screen'), cText = document.getElementById('calib-step-text'), cCount = document.getElementById('counter');

        let mode = 'posture', audioEnabled = true, lastSpeechTime = 0, isAppActive = false, isModalOpen = false, isCalibrating = false, isCustomCalibrated = false;
        let postureType = 'standing'; // 'standing' or 'sitting'
        let autoPostureTypeEnabled = true;
        let postureTypeCandidate = null;
        let postureTypeCandidateSince = 0;
        let standingSideIssueCandidate = null;
        let standingSideIssueSince = 0;
        let standingSideLastStableError = "";
        let frontalHeadIssueSince = 0;
        let frontalHeadIssueActive = false;

        let sessionData = {
            posture: { good: 0, bad: 0, breaks: 0, lastState: 'neutral', lastWarningText: '', errors: {} },
            catcow: { good: 0, bad: 0, breaks: 0, lastState: 'neutral', lastWarningText: '', errors: {} },
            birddog: { good: 0, bad: 0, breaks: 0, lastState: 'neutral', lastWarningText: '', errors: {} },
            doorway: { good: 0, bad: 0, breaks: 0, lastState: 'neutral', lastWarningText: '', errors: {} },
            plank: { good: 0, bad: 0, breaks: 0, lastState: 'neutral', lastWarningText: '', errors: {} },
            bridge: { good: 0, bad: 0, breaks: 0, lastState: 'neutral', lastWarningText: '', errors: {} }
        };

        let lastFrameTime = Date.now();

        // Eşik Değerleri (Hatasız Ölçüm İçin Kusursuzlaştırıldı)
        let limits = { postureLateral: 12, postureFrontalRatio: 2.25, postureSittingFrontalRatio: 1.65, postureTilt: 0.11, postureHeadTilt: 4, postureSpineFrontal: 0.20, postureSittingSpineFrontal: 0.30, postureSpineLateral: 16, postureSittingSpineLateral: 26, postureShoulderLevel: 0.24, postureSittingShoulderLevel: 0.32, postureShoulderCenter: 0.32, postureSittingShoulderCenter: 0.44, postureShoulderStackLateral: 18, postureSittingShoulderStackLateral: 30, postureShoulderDepthFrontal: 0.85, postureSittingShoulderDepthFrontal: 1.05, postureSpineDepthFrontal: 1.15, postureSittingSpineDepthFrontal: 1.45, postureHeadDepthForward: 0.74, postureSittingHeadDepthForward: 0.94, postureFrontalHeadForwardDepth: 0.56, postureSittingFrontalHeadForwardDepth: 0.72, postureFrontalNeckCompressionRatio: 0.78, postureSittingFrontalNeckCompressionRatio: 0.74, postureLateralHeadForwardRight: 11, postureLateralHeadForwardLeft: 11, postureLateralShoulderRight: 18, postureLateralShoulderLeft: 18, postureLateralSpineRight: 16, postureLateralSpineLeft: 16, postureSittingLateralSpineRight: 26, postureSittingLateralSpineLeft: 26, postureStandingEarShoulderOffset: 0.080, postureStandingShoulderHipOffset: 0.105, postureStandingHipAnkleOffset: 0.18, postureStandingKneeAnkleOffset: 0.16, postureStandingKneeBendAngle: 150, postureStandingKyphosisScore: 0.085, postureStandingSpineForwardBend: 5, postureStandingSpineBackwardBend: 9, postureStandingFrontalSpineCurve: 0.13, doorway: 0.15, catcow: 160, birddog: 0.10, plankMin: 165, plankMax: 185, bridgeMin: 145 };
        let activeCalibType = "", tempCalibData = [], emaVal = null;

        window.speechQueue = [];
        let lastSpokenText = "";
        let lastSpokenAt = 0;
        let activeSpeechText = "";
        let activeSpeechKey = "";
        let activeSpeechType = "";
        let pendingSpeechAlert = null;
        let pendingSpeechTimer = null;
        let spokenAlertKeysThisCycle = new Set();
        let pendingPositiveSpeech = null;
        let pendingPositiveTimer = null;
        let lastPositiveSpeechAt = 0;

        function normalizeSpeechText(txt) {
            return String(txt || '').replace(/\s+/g, ' ').trim();
        }

        function normalizeSpeechKey(txt) {
            return normalizeSpeechText(txt)
                .toLowerCase()
                .replace(/[✅⚠️⛔👀🎯🔄💡📊🔊🔇▶️🧍🪑]/g, '')
                .replace(/[.!?…]+$/g, '')
                .replace(/\s+/g, ' ')
                .trim();
        }

        function isCountdownSpeech(txt) {
            return /^\d+$/.test(normalizeSpeechText(txt));
        }

        function isRecoverySpeech(txt) {
            return normalizeSpeechKey(txt) === 'formunuz düzeldi';
        }

        function isSystemSpeechMessage(txt) {
            const t = normalizeSpeechText(txt);
            const key = normalizeSpeechKey(t);
            if (!t) return false;
            if (isCountdownSpeech(t) || isRecoverySpeech(t)) return true;
            return key.includes('hoş geldiniz') || key.includes('kalibrasyon tamamlandı') || key.includes('kaydedildi') || key.includes('başlatılıyor');
        }

        function resetSpeechAlertCycle() {
            pendingSpeechAlert = null;
            spokenAlertKeysThisCycle.clear();
            activeSpeechKey = '';
        }

        function currentVisibleAlertText() {
            return (aSub && aSub.innerText) ? normalizeSpeechText(aSub.innerText) : '';
        }

        function isAlertStillValid(item) {
            if (!item || !item.key) return false;
            const data = sessionData[item.modeName || mode];
            if (!data || (data.lastState !== 'bad' && data.lastState !== 'setupError')) return false;
            const visibleKey = normalizeSpeechKey(currentVisibleAlertText());
            if (!visibleKey) return false;
            return visibleKey === item.key;
        }

        function scheduleSpeechDrain(delay = 250) {
            if (pendingSpeechTimer) clearTimeout(pendingSpeechTimer);
            pendingSpeechTimer = setTimeout(() => {
                pendingSpeechTimer = null;
                drainPendingSpeechAlert();
            }, delay);
        }

        function drainPendingSpeechAlert() {
            if (!pendingSpeechAlert) return;
            if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
                scheduleSpeechDrain(350);
                return;
            }
            const item = pendingSpeechAlert;
            pendingSpeechAlert = null;
            if (!isAlertStillValid(item)) return;
            if (spokenAlertKeysThisCycle.has(item.key)) return;
            speakNow(item.text, { type: 'alert', key: item.key, force: false });
        }

        function speakNow(cleanText, opts = {}) {
            const text = normalizeSpeechText(cleanText);
            if (!audioEnabled || !text) return;

            const type = opts.type || 'system';
            const key = opts.key || normalizeSpeechKey(text);
            const force = !!opts.force;

            if (force) window.speechSynthesis.cancel();

            const msg = new SpeechSynthesisUtterance(text);
            msg.lang = 'tr-TR';
            msg.rate = 1.0;
            msg.onstart = () => {
                activeSpeechText = text;
                activeSpeechKey = key;
                activeSpeechType = type;
                if (type === 'alert') spokenAlertKeysThisCycle.add(key);
            };
            const finish = () => {
                activeSpeechText = '';
                activeSpeechKey = '';
                activeSpeechType = '';
                scheduleSpeechDrain(180);
            };
            msg.onend = finish;
            msg.onerror = finish;

            window.speechQueue.push(text);
            if (window.speechQueue.length > 5) window.speechQueue.shift();
            window.speechSynthesis.speak(msg);
            lastSpeechTime = Date.now();
            lastSpokenAt = lastSpeechTime;
            lastSpokenText = text;
        }

        function schedulePositiveSpeech(delay = 350) {
            if (pendingPositiveTimer) clearTimeout(pendingPositiveTimer);
            pendingPositiveTimer = setTimeout(() => {
                pendingPositiveTimer = null;
                drainPendingPositiveSpeech();
            }, delay);
        }

        function drainPendingPositiveSpeech() {
            if (!pendingPositiveSpeech) return;
            if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
                schedulePositiveSpeech(350);
                return;
            }
            const item = pendingPositiveSpeech;
            const data = sessionData[item.modeName || mode];
            if (!data || data.lastState !== 'good') {
                pendingPositiveSpeech = null;
                return;
            }
            if (Date.now() - lastPositiveSpeechAt < 4500) {
                pendingPositiveSpeech = null;
                return;
            }
            pendingPositiveSpeech = null;
            lastPositiveSpeechAt = Date.now();
            speakNow(item.text, { type: 'system', key: 'positive-form', force: false });
        }

        function queuePositiveSpeech(txt) {
            const cleanText = normalizeSpeechText(txt);
            if (!audioEnabled || !cleanText) return;
            if (Date.now() - lastPositiveSpeechAt < 4500) return;
            pendingPositiveSpeech = { text: cleanText, modeName: mode, createdAt: Date.now() };
            if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
                schedulePositiveSpeech(350);
                return;
            }
            drainPendingPositiveSpeech();
        }

        function queueAlertSpeech(txt) {
            const cleanText = normalizeSpeechText(txt);
            if (!audioEnabled || !cleanText) return;

            const key = normalizeSpeechKey(cleanText);
            if (!key) return;

            // Aynı bozuk form sürecinde aynı uyarıyı sadece bir kez oku.
            if (spokenAlertKeysThisCycle.has(key) || activeSpeechKey === key) return;

            const item = { text: cleanText, key, modeName: mode, createdAt: Date.now() };

            // Ses devam ediyorsa kesme. Kuyruğa sadece en güncel uyarıyı bırak.
            if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
                pendingSpeechAlert = item;
                return;
            }

            const minGap = 1200;
            const wait = Math.max(0, minGap - (Date.now() - lastSpeechTime));
            if (wait > 0) {
                pendingSpeechAlert = item;
                scheduleSpeechDrain(wait + 50);
                return;
            }

            speakNow(cleanText, { type: 'alert', key, force: false });
        }

        function announce(txt, force = false) {
            if (!audioEnabled || !txt) return;
            const cleanText = normalizeSpeechText(txt);
            if (!cleanText) return;

            if (isRecoverySpeech(cleanText)) {
                // Form düzeldiyse bekleyen uyarıları iptal et ve aynı hata için konuşma kilidini sıfırla.
                resetSpeechAlertCycle();
                if (window.speechSynthesis.speaking || window.speechSynthesis.pending) return;
                if (Date.now() - lastSpeechTime < 1200) return;
                return speakNow(cleanText, { type: 'system', key: normalizeSpeechKey(cleanText), force: false });
            }

            if (isSystemSpeechMessage(cleanText)) {
                return speakNow(cleanText, { type: 'system', key: normalizeSpeechKey(cleanText), force });
            }

            // Normal postür/egzersiz uyarıları: asla mevcut sesi kesme.
            queueAlertSpeech(cleanText);
        }

        function registerWarningForMode(modeName, text) {
            const data = sessionData[modeName];
            if (!data || !text) return;
            if (!data.errors[text]) data.errors[text] = 0;
            data.errors[text]++;
        }


        let warningRotationKey = "";
        let warningRotationIndex = 0;
        let warningRotationTime = 0;
        function pickRotatingWarning(candidates) {
            const list = [...new Set((candidates || []).filter(Boolean))];
            if (list.length === 0) return "";
            if (list.length === 1) return list[0];

            const key = list.join('|');
            const now = Date.now();
            if (key !== warningRotationKey) {
                warningRotationKey = key;
                warningRotationIndex = 0;
                warningRotationTime = now;
            } else if (now - warningRotationTime > 2800) {
                warningRotationIndex = (warningRotationIndex + 1) % list.length;
                warningRotationTime = now;
            }
            return list[warningRotationIndex];
        }

        const warningVariantState = {};
        const warningVariantCursor = {};

        function getVariantWarning(key, variants) {
            const list = [...new Set((variants || []).filter(Boolean))];
            if (!key || list.length === 0) return "";
            if (!warningVariantState[key]) {
                const nextIndex = (warningVariantCursor[key] || 0) % list.length;
                warningVariantState[key] = list[nextIndex];
                warningVariantCursor[key] = (nextIndex + 1) % list.length;
            }
            return warningVariantState[key];
        }

        function clearVariantWarning(key) {
            if (key && warningVariantState[key]) delete warningVariantState[key];
        }

        function addVariantWarning(condition, key, variants, collector) {
            if (!collector) return;
            if (condition) {
                const msg = getVariantWarning(key, variants);
                if (msg) collector.push(msg);
            } else {
                clearVariantWarning(key);
            }
        }

        function initApp(startCalib) {
            document.getElementById('welcome-cover').style.display = 'none'; isAppActive = true; isModalOpen = false; emaVal = null;
            window.speechSynthesis.speak(new SpeechSynthesisUtterance("")); announce("Mutlak Doğruluk Sistemine Hoş Geldiniz.", true);
            lastFrameTime = Date.now(); switchMode('posture');
            if (startCalib) openCalibrationMenu(); else isCustomCalibrated = false;
        }

        const modeTitleMap = { posture: 'Postür', catcow: 'Kedi-İnek', birddog: 'Kuş-Köpek', doorway: 'Eşik Esneme', plank: 'Plank', bridge: 'Köprü' };

        function closeMobileModeMenu() {
            const bar = document.querySelector('.mobile-mode-bar');
            const toggle = document.getElementById('mobile-mode-toggle');
            if (bar) bar.classList.remove('open');
            if (toggle) toggle.setAttribute('aria-expanded', 'false');
        }

        function updateMobileModeMenu(activeMode) {
            const current = document.getElementById('mobile-mode-current');
            if (current) current.innerText = modeTitleMap[activeMode] || 'Postür';
            document.querySelectorAll('.mobile-mode-item').forEach(btn => btn.classList.toggle('active', btn.dataset.mode === activeMode));
        }

        function toggleMobileModeMenu() {
            const bar = document.querySelector('.mobile-mode-bar');
            const toggle = document.getElementById('mobile-mode-toggle');
            if (!bar) return;
            const willOpen = !bar.classList.contains('open');
            bar.classList.toggle('open', willOpen);
            if (toggle) toggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
        }

        function selectMobileMode(m) {
            switchMode(m);
            closeMobileModeMenu();
        }

        window.toggleMobileModeMenu = toggleMobileModeMenu;
        window.selectMobileMode = selectMobileMode;

        function switchMode(m) {
            mode = m; emaVal = null;
            document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
            const desktopBtn = document.getElementById(`btn-${m}`);
            if (desktopBtn) desktopBtn.classList.add('active');
            updateMobileModeMenu(m);

            // Postür seçici görünürlük kontrolü
            const selector = document.getElementById('posture-type-selector');
            if (selector) {
                selector.style.display = (m === 'posture') ? 'flex' : 'none';
            }

            const titles = { posture: 'POSTÜR ANALİZİ', catcow: 'KEDİ-İNEK FORMU', birddog: 'KUŞ-KÖPEK DENGESİ', doorway: 'EŞİK ESNEMESİ', plank: 'PLANK (CORE)', bridge: 'KÖPRÜ (KALÇA)' };
            aMain.innerText = titles[m];

            if (m === 'posture') {
                if (postureType === 'standing') {
                    aSub.innerText = "Lütfen kameraya YAN (Profil) dönün.";
                } else {
                    aSub.innerText = "Otururken ÖNDEN veya YANDAN dik duruş algılanır; gerekirse kalibre edin.";
                }
            }
            else if (m === 'plank' || m === 'catcow' || m === 'birddog' || m === 'bridge') aSub.innerText = "Lütfen kameraya YAN dönerek pozisyon alın.";
            else aSub.innerText = "Lütfen pozisyonunuzu alın.";

            document.getElementById('timer-good').innerText = format(sessionData[m].good); document.getElementById('timer-bad').innerText = format(sessionData[m].bad); document.getElementById('count-breaks').innerText = sessionData[m].breaks;
            lastFrameTime = Date.now();
        }

        function setPostureType(type, source = 'manual') {
            postureType = type;
            if (source === 'manual') autoPostureTypeEnabled = true;

            document.querySelectorAll('.posture-type-btn').forEach(btn => {
                btn.style.background = 'transparent';
                btn.style.color = '#94a3b8';
                btn.classList.remove('active');
            });
            const activeBtn = document.getElementById(`posture-btn-${type}`);
            if (activeBtn) {
                activeBtn.style.background = 'linear-gradient(135deg, var(--neon), var(--deep))';
                activeBtn.style.color = 'white';
                activeBtn.classList.add('active');
            }

            if (type === 'standing') {
                aSub.innerText = source === 'auto' ? "Otomatik algılandı: Ayakta postür modu." : "Lütfen kameraya YAN (Profil) dönün.";
            } else {
                aSub.innerText = source === 'auto' ? "Otomatik algılandı: Oturur postür modu." : "Otururken ÖNDEN veya YANDAN dik duruş algılanır; gerekirse kalibre edin.";
            }
            emaVal = null;
            standingSideIssueCandidate = null;
            standingSideIssueSince = 0;
            standingSideLastStableError = "";
            frontalHeadIssueSince = 0;
            frontalHeadIssueActive = false;
            lastFrameTime = Date.now();
        }

        function showRecommendations() {
            isModalOpen = true;
            let data = sessionData[mode], totalSec = Math.floor((data.good + data.bad) / 1000), timeStr = format(data.good + data.bad), advice = "";
            if (totalSec < 5) advice = `Henüz yeterli veri toplanmadı. 5-10 saniye analiz yaptıktan sonra daha doğru öneri üretebilirim.`;
            else {
                let maxCount = 0, topError = "";
                for (let err in data.errors) { if (data.errors[err] > maxCount) { maxCount = data.errors[err]; topError = err; } }
                if (maxCount === 0) advice = `Harika! ${timeStr} boyunca hiç hata yapmadınız. Aynı kamera mesafesiyle günlük hedefinizi artırabilirsiniz.`;
                else if (window.RetinaCoach) {
                    const fixes = window.RetinaCoach.createAdviceBlocks({ topError }).join("\n• ");
                    advice = `Sık karşılaşılan sorun:\n"${topError}" (${maxCount} kez).\n\nDüzeltme programı:\n• ${fixes}`;
                } else advice = `Sık karşılaşılan sorun:\n"${topError}" (${maxCount} kez).`;
            }
            document.getElementById('rec-text').innerText = advice; document.getElementById('rec-modal').style.display = 'flex';
        }
        function closeRecommendations() { document.getElementById('rec-modal').style.display = 'none'; isModalOpen = false; }
        function toggleAudio() { audioEnabled = !audioEnabled; document.getElementById('mute-toggle').innerText = audioEnabled ? '🔊 SES AÇIK' : '🔇 SESSİZ'; }
        function format(ms) { let s = Math.floor(ms / 1000); return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`; }

        function openCalibrationMenu() {
            isModalOpen = true; const container = document.getElementById('calib-options-container'); container.innerHTML = ''; emaVal = null;
            let directions = (mode === 'posture') ? ["Önden", "Sağ Yan", "Sol Yan"] : ["Ön Cephe", "Arka Cephe"];
            directions.forEach(dir => { let btn = document.createElement('button'); btn.className = 'btn-main btn-default'; btn.innerText = `🎯 ${dir}`; btn.onclick = () => runSingleCalibration(dir, btn); container.appendChild(btn); });
            document.getElementById('calib-menu').style.display = 'flex';
        }

        function runSingleCalibration(dir, btn) {
            document.getElementById('calib-menu').style.display = 'none'; cScreen.style.display = 'flex'; cText.innerText = `${dir.toUpperCase()} DÖNÜN`;
            activeCalibType = (dir === "Önden") ? "frontal" : (dir === "Sağ Yan" ? "rightLateral" : (dir === "Sol Yan" ? "leftLateral" : "lateral")); tempCalibData = [];
            let timer = 5; cCount.innerText = timer; announce(timer.toString(), true);
            const interval = setInterval(() => {
                timer--; cCount.innerText = timer; if (timer > 0) announce(timer.toString(), true);
                if (timer === 0) {
                    clearInterval(interval); isCalibrating = "CAPTURE";
                    setTimeout(() => { cScreen.style.display = 'none'; document.getElementById('calib-menu').style.display = 'flex'; btn.innerText = `✅ ${dir}`; btn.style.color = 'var(--success)'; btn.onclick = null; announce(dir + " kaydedildi.", true); }, 600);
                }
            }, 1000);
        }
        function finishCalibration() { document.getElementById('calib-menu').style.display = 'none'; isCustomCalibrated = true; isModalOpen = false; announce("Kalibrasyon tamamlandı.", true); }
        function checkVisibility(arr) { return arr.every(pt => pt && pt.visibility > 0.60); }

        // YENİ: Açı Hesaplama Yardımcı Fonksiyonu
        function calculateAngle(A, B, C) {
            let rad = Math.atan2(C.y - B.y, C.x - B.x) - Math.atan2(A.y - B.y, A.x - B.x);
            let deg = Math.abs(rad * 180.0 / Math.PI);
            if (deg > 180.0) deg = 360.0 - deg;
            return deg;
        }

        // Aktif yan tespiti: Sol yan mı sağ yan mı kamerada daha güvenilir görünüyor?
        function getActiveSide(p) {
            const lv = (i) => p[i] ? (p[i].visibility === undefined ? 1 : p[i].visibility) : 0;

            let leftVis = lv(11) + lv(7) + lv(13) + lv(15) + lv(23) + lv(25) + lv(27);
            let rightVis = lv(12) + lv(8) + lv(14) + lv(16) + lv(24) + lv(26) + lv(28);

            const useLeft = leftVis >= rightVis;
            const total = Math.max(leftVis + rightVis, 0.001);
            const confidence = Math.abs(leftVis - rightVis) / total;

            return useLeft ?
                { label: 'left', tr: 'Sol Yan', oppositeLabel: 'right', confidence, sh: p[11], hip: p[23], knee: p[25], ankle: p[27], el: p[13], wr: p[15], ear: p[7] } :
                { label: 'right', tr: 'Sağ Yan', oppositeLabel: 'left', confidence, sh: p[12], hip: p[24], knee: p[26], ankle: p[28], el: p[14], wr: p[16], ear: p[8] };
        }


        // Baş, boyun ve omuz için daha güvenli nokta üretimi
        function lmToCanvas(pt) {
            return { x: pt.x * canvas.width, y: pt.y * canvas.height };
        }

        function isUsable(pt, minVis = 0.35) {
            return pt && (pt.visibility === undefined || pt.visibility > minVis);
        }

        function getVisibility(pt) {
            return pt ? (pt.visibility === undefined ? 1 : pt.visibility) : 0;
        }

        function dist2D(a, b) {
            if (!a || !b) return 0;
            return Math.hypot(a.x - b.x, a.y - b.y);
        }

        function clampValue(v, min, max) {
            return Math.max(min, Math.min(max, v));
        }

        function getMidPoint(a, b, fallback = null) {
            if (isUsable(a) && isUsable(b)) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (((a.z || 0) + (b.z || 0)) / 2), visibility: Math.min(a.visibility || 1, b.visibility || 1) };
            if (isUsable(a)) return a;
            if (isUsable(b)) return b;
            return fallback;
        }

        function getHeadNeckModel(p, side, isFrontal) {
            const midShoulder = getMidPoint(p[11], p[12], side.sh);
            const midHip = getMidPoint(p[23], p[24], side.hip);
            const eyeMid = getMidPoint(p[2], p[5], null);
            const earMid = getMidPoint(p[7], p[8], side.ear);
            const mouthMid = getMidPoint(p[9], p[10], null);
            const nose = isUsable(p[0], 0.25) ? p[0] : null;

            let headCenter = null;
            if (isFrontal) {
                headCenter = eyeMid || nose || earMid;
            } else {
                headCenter = side.ear || earMid || eyeMid || nose;
            }
            if (!headCenter && midShoulder) {
                headCenter = { x: midShoulder.x, y: midShoulder.y - 0.18, visibility: 0.4 };
            }

            const neckBase = midShoulder;
            let neckTop = null;
            if (neckBase && headCenter) {
                neckTop = {
                    x: headCenter.x + (neckBase.x - headCenter.x) * 0.42,
                    y: headCenter.y + (neckBase.y - headCenter.y) * 0.42,
                    visibility: Math.min(headCenter.visibility || 1, neckBase.visibility || 1)
                };
            }
            return { midShoulder, midHip, eyeMid, earMid, mouthMid, nose, headCenter, neckBase, neckTop };
        }

        function interpolateLandmark(a, b, t) {
            if (!a || !b) return null;
            return {
                x: a.x + (b.x - a.x) * t,
                y: a.y + (b.y - a.y) * t,
                z: (typeof a.z === 'number' && typeof b.z === 'number') ? (a.z + (b.z - a.z) * t) : (((a.z || 0) + (b.z || 0)) / 2),
                visibility: Math.min(a.visibility || 1, b.visibility || 1),
                synthetic: a.synthetic || b.synthetic || false
            };
        }

        // Omurga artık ayrı bir "görsel çizgi" değil; baş-boyun-omuz-kalça eklem zincirinin parçası.
        // Analiz, omuz genişliği yerine gövde uzunluğuna göre normalize edilir; bu daha az false-positive üretir.
        function getSpinePostureModel(p, side, isFrontal) {
            const m = getHeadNeckModel(p, side, isFrontal);

            const bothShoulders = isUsable(p[11], 0.25) && isUsable(p[12], 0.25);
            const shoulderSpan = bothShoulders
                ? Math.max(Math.hypot(p[11].x - p[12].x, p[11].y - p[12].y), 0.08)
                : 0.22;

            // Yan profilde aktif taraftaki omuz/kalça, ön profilde orta noktalar daha güvenilir.
            const analysisNeckBase = (!isFrontal && isUsable(side.sh, 0.30)) ? side.sh : m.neckBase;
            const realHipCandidate = (!isFrontal && isUsable(side.hip, 0.30)) ? side.hip : m.midHip;
            const hasRealHip = isUsable(realHipCandidate, 0.30);

            const spineBase = hasRealHip ? realHipCandidate : (m.neckBase ? {
                x: m.neckBase.x,
                y: Math.min(0.98, m.neckBase.y + 0.28),
                z: typeof m.neckBase.z === 'number' ? m.neckBase.z + 0.02 : 0,
                visibility: 0.35,
                synthetic: true
            } : null);

            const neckBase = analysisNeckBase || m.neckBase;
            const upperSpine = interpolateLandmark(neckBase, spineBase, 0.34);
            const midSpine = interpolateLandmark(neckBase, spineBase, 0.58);
            const lowerSpine = interpolateLandmark(neckBase, spineBase, 0.78);

            let frontalOffset = 0;
            let lateralAngle = 0;
            let torsoLength = 0;
            let confidence = 0;

            if (neckBase && spineBase && hasRealHip) {
                torsoLength = Math.max(dist2D(neckBase, spineBase), shoulderSpan * 1.15, 0.16);
                frontalOffset = Math.abs(neckBase.x - spineBase.x) / torsoLength;
                lateralAngle = Math.round(Math.atan2((neckBase.x - spineBase.x), Math.max(Math.abs(spineBase.y - neckBase.y), 0.035)) * (180 / Math.PI));

                const visibilityScore = (getVisibility(neckBase) + getVisibility(spineBase)) / 2;
                const sizeScore = clampValue(torsoLength / Math.max(shoulderSpan, 0.08), 0, 1);
                confidence = clampValue(visibilityScore * sizeScore, 0, 1);
            }

            return {
                ...m,
                neckBase,
                spineBase,
                upperSpine,
                midSpine,
                lowerSpine,
                hasRealHip,
                torsoLength,
                confidence,
                shoulderSpan,
                frontalOffset,
                lateralAngle,
                joints: [m.headCenter, m.neckTop, neckBase, upperSpine, midSpine, lowerSpine, spineBase].filter(Boolean)
            };
        }

        function hasDepth(pt) {
            return !!(pt && typeof pt.z === 'number' && Number.isFinite(pt.z));
        }

        // Tek kameradan gelen z-koordinatlarını kullanarak tahmini 3B postür analizi.
        // Bu değer tek kamerada gürültülü olabildiği için sadece yüksek güvenli ve büyük sapmalarda karar etkiler.
        function getDepthPostureModel(p, side, isFrontal) {
            const headModel = getHeadNeckModel(p, side, isFrontal);
            const spineModel = getSpinePostureModel(p, side, isFrontal);
            const shoulderSpan = (isUsable(p[11], 0.25) && isUsable(p[12], 0.25))
                ? Math.max(Math.hypot(p[11].x - p[12].x, p[11].y - p[12].y), 0.12)
                : Math.max(spineModel.shoulderSpan || 0.24, 0.12);
            const depthScale = Math.max(shoulderSpan * 1.65, spineModel.torsoLength || 0.20, 0.20);

            let shoulderDepthDiff = 0;
            let shoulderDepthSigned = 0;
            let hasShoulderDepth = false;
            if (isUsable(p[11], 0.55) && isUsable(p[12], 0.55) && hasDepth(p[11]) && hasDepth(p[12])) {
                shoulderDepthSigned = (p[11].z - p[12].z) / depthScale;
                shoulderDepthDiff = Math.abs(shoulderDepthSigned);
                hasShoulderDepth = true;
            }

            let spineDepthOffset = 0;
            let hasSpineDepth = false;
            if (spineModel.confidence > 0.62 && spineModel.neckBase && spineModel.spineBase && hasDepth(spineModel.neckBase) && hasDepth(spineModel.spineBase)) {
                // Pozitif değer = omuz/boyun hattı kalçaya göre kameraya daha yakın (öne eğilme)
                spineDepthOffset = (spineModel.spineBase.z - spineModel.neckBase.z) / depthScale;
                hasSpineDepth = true;
            }

            let headForwardDepth = 0;
            let hasHeadDepth = false;
            if (headModel.headCenter && headModel.neckBase && hasDepth(headModel.headCenter) && hasDepth(headModel.neckBase) && getVisibility(headModel.headCenter) > 0.32) {
                // Pozitif değer = baş boyun köküne göre kameraya daha yakın/ileri
                headForwardDepth = (headModel.neckBase.z - headModel.headCenter.z) / depthScale;
                hasHeadDepth = true;
            }

            return {
                shoulderSpan,
                depthScale,
                hasShoulderDepth,
                shoulderDepthDiff,
                shoulderDepthSigned,
                hasSpineDepth,
                spineDepthOffset,
                hasHeadDepth,
                headForwardDepth
            };
        }


        function getShoulderAlignmentModel(p, side, isFrontal) {
            const m = getHeadNeckModel(p, side, isFrontal);
            const spine = getSpinePostureModel(p, side, isFrontal);
            const leftShoulder = isUsable(p[11], 0.30) ? p[11] : null;
            const rightShoulder = isUsable(p[12], 0.30) ? p[12] : null;
            const hasBothShoulders = !!(leftShoulder && rightShoulder);
            const shoulderSpan = hasBothShoulders
                ? Math.max(Math.hypot(leftShoulder.x - rightShoulder.x, leftShoulder.y - rightShoulder.y), 0.08)
                : Math.max(spine.shoulderSpan || 0.22, 0.08);
            const midShoulder = m.midShoulder || side.sh;
            const centerTarget = spine.hasRealHip ? spine.spineBase : (m.headCenter || m.neckBase);

            let levelOffset = 0;
            let levelDeg = 0;
            if (hasBothShoulders) {
                levelOffset = Math.abs(leftShoulder.y - rightShoulder.y) / shoulderSpan;
                levelDeg = Math.round(Math.atan2(Math.abs(leftShoulder.y - rightShoulder.y), Math.max(Math.abs(leftShoulder.x - rightShoulder.x), 0.015)) * (180 / Math.PI));
            }

            let centerOffset = 0;
            if (midShoulder && centerTarget) {
                centerOffset = Math.abs(midShoulder.x - centerTarget.x) / shoulderSpan;
            }

            let stackAngle = 0;
            let hasLateralStack = false;
            if (!isFrontal && isUsable(side.sh, 0.30) && isUsable(side.hip, 0.30)) {
                hasLateralStack = true;
                stackAngle = Math.round(Math.atan2((side.sh.x - side.hip.x), Math.max(Math.abs(side.hip.y - side.sh.y), 0.035)) * (180 / Math.PI));
            }

            return {
                leftShoulder,
                rightShoulder,
                midShoulder,
                centerTarget,
                hasBothShoulders,
                shoulderSpan,
                levelOffset,
                levelDeg,
                centerOffset,
                stackAngle,
                hasLateralStack
            };
        }

        function getLateralPostureSideLimits(sideLabel) {
            const isLeft = sideLabel === 'left';
            return {
                headForward: isLeft ? limits.postureLateralHeadForwardLeft : limits.postureLateralHeadForwardRight,
                shoulderStack: isLeft ? limits.postureLateralShoulderLeft : limits.postureLateralShoulderRight,
                spineStanding: isLeft ? limits.postureLateralSpineLeft : limits.postureLateralSpineRight,
                spineSitting: isLeft ? limits.postureSittingLateralSpineLeft : limits.postureSittingLateralSpineRight
            };
        }

        function signedSideOffset(point, reference, forwardSign, scale) {
            if (!point || !reference || !forwardSign || !scale) return 0;
            return ((point.x - reference.x) * forwardSign) / Math.max(scale, 0.08);
        }

        function getSideFacingDirection(p, side) {
            // Pozitif = kişinin ön tarafı ekranda sağa bakıyor, negatif = sola bakıyor.
            // Burun görünürse en güvenilir ipucu budur.
            if (isUsable(p[0], 0.25) && isUsable(side.ear, 0.25)) {
                const dx = p[0].x - side.ear.x;
                if (Math.abs(dx) > 0.012) return dx > 0 ? 1 : -1;
            }
            if (isUsable(p[0], 0.25) && isUsable(side.sh, 0.25)) {
                const dx = p[0].x - side.sh.x;
                if (Math.abs(dx) > 0.02) return dx > 0 ? 1 : -1;
            }
            if (isUsable(side.ear, 0.25) && isUsable(side.sh, 0.25)) {
                const dx = side.ear.x - side.sh.x;
                if (Math.abs(dx) > 0.02) return dx > 0 ? 1 : -1;
            }
            return side.label === 'left' ? 1 : -1;
        }

        function getStandingSideChainModel(p, side, isFrontal) {
            const headModel = getHeadNeckModel(p, side, isFrontal);
            const headPoint = headModel.headCenter || side.ear;
            const forwardSign = getSideFacingDirection(p, side);
            const sideName = side.tr || (side.label === 'left' ? 'Sol Yan' : 'Sağ Yan');

            const hasCore = isUsable(headPoint, 0.30) && isUsable(side.sh, 0.30) && isUsable(side.hip, 0.30);
            const hasFullChain = hasCore && isUsable(side.knee, 0.30) && isUsable(side.ankle, 0.28);
            const bodyHeightScale = hasFullChain
                ? Math.max(Math.abs(side.ankle.y - headPoint.y), Math.abs(side.ankle.y - side.sh.y), 0.28)
                : Math.max(dist2D(side.sh, side.hip) * 2.2, 0.28);

            const earShoulderOffset = hasCore ? signedSideOffset(headPoint, side.sh, forwardSign, bodyHeightScale) : 0;
            const shoulderHipOffset = hasCore ? signedSideOffset(side.sh, side.hip, forwardSign, bodyHeightScale) : 0;
            const hipAnkleOffset = hasFullChain ? signedSideOffset(side.hip, side.ankle, forwardSign, bodyHeightScale) : 0;
            const kneeAnkleOffset = hasFullChain ? signedSideOffset(side.knee, side.ankle, forwardSign, bodyHeightScale) : 0;

            // Ayakta omurga/kamburluk ölçümleri:
            // Pozitif değer = kişinin ön tarafına doğru kapanma/öne eğilme.
            const spineForwardBendAngle = hasCore
                ? Math.round(Math.atan2((side.sh.x - side.hip.x) * forwardSign, Math.max(Math.abs(side.hip.y - side.sh.y), 0.035)) * (180 / Math.PI))
                : 0;
            const kyphosisScore = hasCore
                ? Math.max(0, earShoulderOffset) + Math.max(0, shoulderHipOffset * 0.85)
                : 0;

            let kneeAngle = 180;
            let hasKneeAngle = false;
            if (hasFullChain) {
                hasKneeAngle = true;
                kneeAngle = calculateAngle(side.hip, side.knee, side.ankle);
            }

            let primaryError = "";
            let primaryCode = "";
            if (postureType === 'standing' && !isFrontal && hasCore) {
                const headLimit = limits.postureStandingEarShoulderOffset * 0.70;
                const shoulderLimit = limits.postureStandingShoulderHipOffset * 0.80;
                const hipLimit = limits.postureStandingHipAnkleOffset;
                const kneeStackLimit = limits.postureStandingKneeAnkleOffset;

                // Omurga/kamburluk kontrolleri baş ve omuz tekil hatalarından önce gelir.
                if (kyphosisScore > limits.postureStandingKyphosisScore && spineForwardBendAngle > 2) {
                    primaryCode = "standing-kyphosis";
                    primaryError = `${sideName} ayakta omurga hatası: Kamburluk algılandı. Göğsünüzü açın, çeneyi hafif geriye alın ve omuzları geriye bırakın.`;
                } else if (spineForwardBendAngle > limits.postureStandingSpineForwardBend) {
                    primaryCode = "standing-spine-forward";
                    primaryError = `${sideName} ayakta omurga hatası: Gövdeniz/omurganız öne eğilmiş. Bel-kalça hattını merkeze alıp dikleşin.`;
                } else if (spineForwardBendAngle < -limits.postureStandingSpineBackwardBend) {
                    primaryCode = "standing-spine-backward";
                    primaryError = `${sideName} ayakta omurga hatası: Geriye fazla yaslanıyorsunuz. Gövdeyi kalça hattının üzerine alın.`;
                }
                // Dead-zone: limitlerin hemen üstündeki küçük sapmaları hata sayma.
                else if (earShoulderOffset > headLimit) {
                    primaryCode = "head-forward";
                    primaryError = `${sideName} ayakta duruş hatası: Başınız omuz hattının önünde. Çeneyi hafif geriye çekin.`;
                } else if (earShoulderOffset < -headLimit * 1.45) {
                    primaryCode = "head-back";
                    primaryError = `${sideName} ayakta duruş hatası: Başınız omuz hattının gerisinde. Boynu merkeze alın.`;
                } else if (shoulderHipOffset > shoulderLimit) {
                    primaryCode = "shoulder-forward";
                    primaryError = `${sideName} ayakta duruş hatası: Omuzlar kalçanın önünde. Göğsü açıp omuzları geriye alın.`;
                } else if (shoulderHipOffset < -shoulderLimit * 1.25) {
                    primaryCode = "shoulder-back";
                    primaryError = `${sideName} ayakta duruş hatası: Omuzlar kalçanın gerisinde. Gövdeyi merkeze taşıyın.`;
                } else if (hasFullChain && hipAnkleOffset > hipLimit) {
                    primaryCode = "hip-forward";
                    primaryError = `${sideName} ayakta duruş hatası: Kalça ayak hattının önünde. Pelvisi merkeze alın.`;
                } else if (hasFullChain && hipAnkleOffset < -hipLimit * 1.25) {
                    primaryCode = "hip-back";
                    primaryError = `${sideName} ayakta duruş hatası: Kalça ayak hattının gerisinde. Ağırlığı ayak ortasına alın.`;
                } else if (hasFullChain && Math.abs(kneeAnkleOffset) > kneeStackLimit) {
                    primaryCode = "knee-stack";
                    primaryError = `${sideName} ayakta duruş hatası: Diz-ayak bileği hattı bozuk. Dizleri ayak hattına alın.`;
                } else if (hasKneeAngle && kneeAngle < limits.postureStandingKneeBendAngle) {
                    primaryCode = "knee-bent";
                    primaryError = `${sideName} ayakta duruş hatası: Dizler fazla kırık. Bacakları doğal şekilde uzatın.`;
                }
            }

            return {
                sideName,
                forwardSign,
                hasCore,
                hasFullChain,
                bodyHeightScale,
                earShoulderOffset,
                shoulderHipOffset,
                hipAnkleOffset,
                kneeAnkleOffset,
                spineForwardBendAngle,
                kyphosisScore,
                kneeAngle,
                hasKneeAngle,
                primaryError,
                primaryCode
            };
        }

        function getLateralSidePostureModel(p, side, isFrontal) {
            const headModel = getHeadNeckModel(p, side, isFrontal);
            const headPoint = headModel.headCenter || side.ear;
            const sideName = side.tr || (side.label === 'left' ? 'Sol Yan' : 'Sağ Yan');
            const sideLabel = side.label || 'right';
            const sideLimits = getLateralPostureSideLimits(sideLabel);

            let headForwardAngle = 0;
            let shoulderHipAngle = 0;
            let spineAngle = 0;
            let hipKneeStackAngle = 0;
            let hasHead = false;
            let hasShoulderHip = false;
            let hasSpine = false;
            let hasLowerBody = false;

            if (isUsable(headPoint, 0.30) && isUsable(side.sh, 0.30)) {
                hasHead = true;
                headForwardAngle = Math.round(Math.atan2(Math.abs(headPoint.x - side.sh.x), Math.max(Math.abs(side.sh.y - headPoint.y), 0.035)) * (180 / Math.PI));
            }

            if (isUsable(side.sh, 0.30) && isUsable(side.hip, 0.30)) {
                hasShoulderHip = true;
                shoulderHipAngle = Math.round(Math.atan2((side.sh.x - side.hip.x), Math.max(Math.abs(side.hip.y - side.sh.y), 0.035)) * (180 / Math.PI));
            }

            const spineModel = getSpinePostureModel(p, side, isFrontal);
            if (spineModel.hasRealHip && spineModel.confidence > 0.58) {
                hasSpine = true;
                spineAngle = spineModel.lateralAngle;
            }

            if (isUsable(side.hip, 0.30) && isUsable(side.knee, 0.30)) {
                hasLowerBody = true;
                hipKneeStackAngle = Math.round(Math.atan2((side.hip.x - side.knee.x), Math.max(Math.abs(side.knee.y - side.hip.y), 0.035)) * (180 / Math.PI));
            }

            const standingChain = getStandingSideChainModel(p, side, isFrontal);

            return {
                sideLabel,
                sideName,
                sideConfidence: side.confidence || 0,
                sideLimits,
                standingChain,
                hasHead,
                headForwardAngle,
                hasShoulderHip,
                shoulderHipAngle,
                hasSpine,
                spineAngle,
                hasLowerBody,
                hipKneeStackAngle
            };
        }

        function getStableStandingSideError(standingChain) {
            if (!standingChain || !standingChain.primaryError || postureType !== 'standing') {
                standingSideIssueCandidate = null;
                standingSideIssueSince = 0;
                standingSideLastStableError = "";
                return "";
            }

            const now = Date.now();
            const issueKey = `${standingChain.sideName}:${standingChain.primaryCode}`;

            if (standingSideIssueCandidate !== issueKey) {
                standingSideIssueCandidate = issueKey;
                standingSideIssueSince = now;
                standingSideLastStableError = "";
                return "";
            }

            // Ayakta yan duruşta küçük kamera/landmark titreşimleri normaldir.
            // Omurga/kamburluk hatası 850ms boyunca aynı kalırsa gerçek uyarı sayılır.
            if (now - standingSideIssueSince >= 650) {
                standingSideLastStableError = standingChain.primaryError;
                return standingChain.primaryError;
            }

            return "";
        }

        function drawStandingSideChainGuide(p, side, isFrontal) {
            if (isFrontal || postureType !== 'standing') return;
            const s = getStandingSideChainModel(p, side, isFrontal);
            if (!s.hasCore) return;

            const headModel = getHeadNeckModel(p, side, isFrontal);
            const headPoint = headModel.headCenter || side.ear;
            const chain = [headPoint, side.sh, side.hip, side.knee, side.ankle].filter(pt => isUsable(pt, 0.25));
            for (let i = 0; i < chain.length - 1; i++) {
                drawThickLine(chain[i], chain[i + 1], s.primaryError ? '#ff3d00' : '#00e676', 4);
            }

            if (isUsable(side.ankle, 0.28) && isUsable(headPoint, 0.30)) {
                const ankle = lmToCanvas(side.ankle);
                const topY = Math.min(lmToCanvas(headPoint).y, lmToCanvas(side.sh).y) - 35;
                ctx.beginPath();
                ctx.moveTo(ankle.x, topY);
                ctx.lineTo(ankle.x, ankle.y + 35);
                ctx.strokeStyle = '#64748b';
                ctx.setLineDash([7, 7]);
                ctx.lineWidth = 2;
                ctx.stroke();
                ctx.setLineDash([]);
            }

            if (isUsable(side.sh, 0.30)) {
                const sh = lmToCanvas(side.sh);
                ctx.fillStyle = s.primaryError ? '#ff3d00' : '#00e676';
                ctx.font = 'bold 13px sans-serif';
                ctx.fillText(`Ayakta Zincir: ${s.primaryError ? 'Kontrol Ediliyor' : 'Doğru'}`, sh.x + 14, sh.y - 88);
                ctx.fillStyle = Math.abs(s.earShoulderOffset) <= limits.postureStandingEarShoulderOffset ? '#00e676' : '#ff3d00';
                ctx.fillText(`Kulak-Omuz: ${s.earShoulderOffset.toFixed(2)}`, sh.x + 14, sh.y - 104);
                ctx.fillStyle = (s.kyphosisScore <= limits.postureStandingKyphosisScore && Math.abs(s.spineForwardBendAngle) <= limits.postureStandingSpineBackwardBend) ? '#00e676' : '#ff3d00';
                ctx.fillText(`Omurga/Kambur: ${s.kyphosisScore.toFixed(2)} | ${s.spineForwardBendAngle}°`, sh.x + 14, sh.y - 120);
            }

            if (isUsable(side.hip, 0.30)) {
                const hip = lmToCanvas(side.hip);
                ctx.fillStyle = Math.abs(s.shoulderHipOffset) <= limits.postureStandingShoulderHipOffset ? '#00e676' : '#ff3d00';
                ctx.font = 'bold 13px sans-serif';
                ctx.fillText(`Omuz-Kalça: ${s.shoulderHipOffset.toFixed(2)}`, hip.x + 14, hip.y + 82);
                if (s.hasFullChain) {
                    ctx.fillStyle = Math.abs(s.hipAnkleOffset) <= limits.postureStandingHipAnkleOffset ? '#00e676' : '#ff3d00';
                    ctx.fillText(`Kalça-Ayak: ${s.hipAnkleOffset.toFixed(2)}`, hip.x + 14, hip.y + 100);
                }
            }
        }

        function drawLateralSidePostureGuide(p, side, isFrontal, overlayColor) {
            if (isFrontal) return;
            drawStandingSideChainGuide(p, side, isFrontal);
            const s = getLateralSidePostureModel(p, side, isFrontal);
            const labelBase = s.sideName;

            if (isUsable(side.sh, 0.30)) {
                const sh = lmToCanvas(side.sh);
                ctx.fillStyle = '#f59e0b';
                ctx.font = 'bold 14px sans-serif';
                ctx.fillText(`${labelBase} Analizi`, sh.x + 14, sh.y - 72);
            }

            if (s.hasHead && isUsable(side.sh, 0.30)) {
                const sh = lmToCanvas(side.sh);
                ctx.fillStyle = s.headForwardAngle <= s.sideLimits.headForward ? '#00e676' : '#ff3d00';
                ctx.font = 'bold 13px sans-serif';
                ctx.fillText(`${labelBase} Baş İleri: ${s.headForwardAngle}°`, sh.x + 14, sh.y - 58);
            }

            if (s.hasShoulderHip && isUsable(side.sh, 0.30)) {
                const sh = lmToCanvas(side.sh);
                ctx.fillStyle = Math.abs(s.shoulderHipAngle) <= s.sideLimits.shoulderStack ? '#00e676' : '#ff3d00';
                ctx.font = 'bold 13px sans-serif';
                ctx.fillText(`${labelBase} Omuz-Kalça: ${s.shoulderHipAngle}°`, sh.x + 14, sh.y - 42);
            }

            if (s.hasSpine && isUsable(side.hip, 0.30)) {
                const hip = lmToCanvas(side.hip);
                const spineLimit = postureType === 'sitting' ? s.sideLimits.spineSitting : s.sideLimits.spineStanding;
                ctx.fillStyle = Math.abs(s.spineAngle) <= spineLimit ? '#00e676' : '#ff3d00';
                ctx.font = 'bold 13px sans-serif';
                ctx.fillText(`${labelBase} Omurga: ${s.spineAngle}°`, hip.x + 14, hip.y + 62);
            }

            if (s.hasLowerBody && postureType === 'sitting' && isUsable(side.knee, 0.30)) {
                const knee = lmToCanvas(side.knee);
                ctx.fillStyle = Math.abs(s.hipKneeStackAngle) <= 30 ? '#00e676' : '#ff3d00';
                ctx.font = 'bold 13px sans-serif';
                ctx.fillText(`${labelBase} Kalça-Diz: ${s.hipKneeStackAngle}°`, knee.x + 14, knee.y - 14);
            }
        }

        function drawShoulderAlignmentGuide(p, side, isFrontal, overlayColor) {
            const a = getShoulderAlignmentModel(p, side, isFrontal);
            const levelLimit = (postureType === 'sitting') ? limits.postureSittingShoulderLevel : limits.postureShoulderLevel;
            const centerLimit = (postureType === 'sitting') ? limits.postureSittingShoulderCenter : limits.postureShoulderCenter;
            const stackLimit = (postureType === 'sitting') ? limits.postureSittingShoulderStackLateral : limits.postureShoulderStackLateral;

            if (isFrontal && a.hasBothShoulders) {
                const l = lmToCanvas(a.leftShoulder);
                const r = lmToCanvas(a.rightShoulder);
                const mid = lmToCanvas(a.midShoulder);
                const guideY = (l.y + r.y) / 2;

                ctx.beginPath();
                ctx.moveTo(l.x, guideY);
                ctx.lineTo(r.x, guideY);
                ctx.strokeStyle = '#64748b';
                ctx.setLineDash([8, 7]);
                ctx.lineWidth = 2;
                ctx.stroke();
                ctx.setLineDash([]);

                ctx.beginPath();
                ctx.moveTo(l.x, l.y);
                ctx.lineTo(r.x, r.y);
                ctx.strokeStyle = a.levelOffset <= levelLimit ? '#00e676' : '#ff3d00';
                ctx.lineWidth = 5;
                ctx.lineCap = 'round';
                ctx.stroke();

                if (a.centerTarget) {
                    const target = lmToCanvas(a.centerTarget);
                    ctx.beginPath();
                    ctx.moveTo(mid.x, mid.y);
                    ctx.lineTo(target.x, target.y);
                    ctx.strokeStyle = a.centerOffset <= centerLimit ? '#00e676' : '#ff3d00';
                    ctx.setLineDash([4, 5]);
                    ctx.lineWidth = 2.5;
                    ctx.stroke();
                    ctx.setLineDash([]);
                }

                ctx.fillStyle = a.levelOffset <= levelLimit ? '#00e676' : '#ff3d00';
                ctx.font = 'bold 13px sans-serif';
                ctx.fillText(`Omuz Hizası: ${a.levelDeg}°`, mid.x - 45, mid.y - 34);

                const alignPct = Math.round(a.centerOffset * 100);
                const targetPct = Math.round(centerLimit * 100);
                ctx.fillStyle = a.centerOffset <= centerLimit ? '#00e676' : '#ff3d00';
                ctx.fillText(`Omuz Merkez: ${alignPct}% (Hedef: <${targetPct}%)`, mid.x - 70, mid.y - 52);
            }

            if (!isFrontal && a.hasLateralStack) {
                const sh = lmToCanvas(side.sh);
                const hip = lmToCanvas(side.hip);

                ctx.beginPath();
                ctx.moveTo(hip.x, hip.y);
                ctx.lineTo(hip.x, sh.y);
                ctx.strokeStyle = '#64748b';
                ctx.setLineDash([8, 7]);
                ctx.lineWidth = 2;
                ctx.stroke();
                ctx.setLineDash([]);

                ctx.beginPath();
                ctx.moveTo(hip.x, hip.y);
                ctx.lineTo(sh.x, sh.y);
                ctx.strokeStyle = Math.abs(a.stackAngle) <= stackLimit ? '#00e676' : '#ff3d00';
                ctx.lineWidth = 4;
                ctx.lineCap = 'round';
                ctx.stroke();

                ctx.fillStyle = Math.abs(a.stackAngle) <= stackLimit ? '#00e676' : '#ff3d00';
                ctx.font = 'bold 13px sans-serif';
                ctx.fillText(`Omuz Hiza Açısı: ${a.stackAngle}°`, sh.x + 14, sh.y + 26);
            }
        }

        function drawSpineJoint(pt, color, label = "") {
            if (!pt) return;
            const c = lmToCanvas(pt);
            ctx.beginPath();
            ctx.arc(c.x, c.y, pt.synthetic ? 5 : 7, 0, Math.PI * 2);
            ctx.fillStyle = pt.synthetic ? '#64748b' : color;
            ctx.fill();
            ctx.strokeStyle = '#020617';
            ctx.lineWidth = 2;
            ctx.stroke();
            if (label) {
                ctx.fillStyle = color;
                ctx.font = 'bold 11px sans-serif';
                ctx.fillText(label, c.x + 9, c.y + 4);
            }
        }

        function drawSpinePostureChain(p, side, isFrontal, overlayColor) {
            const s = getSpinePostureModel(p, side, isFrontal);
            if (!s.neckBase || !s.spineBase) return;

            // Omurga eklem zinciri: boyun kökü -> üst sırt -> orta sırt -> bel -> kalça merkezi
            const chain = [s.neckBase, s.upperSpine, s.midSpine, s.lowerSpine, s.spineBase].filter(Boolean);
            for (let i = 0; i < chain.length - 1; i++) drawThickLine(chain[i], chain[i + 1], overlayColor, i === 0 ? 6 : 5);

            // Gerçek omuz ve kalça eklemlerini omurga merkezine bağla
            if (isUsable(p[11], 0.25)) drawThickLine(p[11], s.neckBase, '#00f2fe', 3);
            if (isUsable(p[12], 0.25)) drawThickLine(p[12], s.neckBase, '#00f2fe', 3);
            if (s.hasRealHip) {
                if (isUsable(p[23], 0.25)) drawThickLine(p[23], s.spineBase, '#00f2fe', 3);
                if (isUsable(p[24], 0.25)) drawThickLine(p[24], s.spineBase, '#00f2fe', 3);
            }

            drawSpineJoint(s.neckTop, overlayColor, 'Boyun');
            drawSpineJoint(s.neckBase, overlayColor, 'Omuz');
            drawSpineJoint(s.upperSpine, overlayColor, 'Üst Sırt');
            drawSpineJoint(s.midSpine, overlayColor, 'Omurga');
            drawSpineJoint(s.lowerSpine, overlayColor, 'Bel');
            drawSpineJoint(s.spineBase, overlayColor, s.hasRealHip ? 'Kalça' : 'Oturma Ref.');
        }

        function drawThickLine(a, b, color, width = 4) {
            if (!a || !b) return;
            ctx.beginPath();
            ctx.moveTo(a.x * canvas.width, a.y * canvas.height);
            ctx.lineTo(b.x * canvas.width, b.y * canvas.height);
            ctx.strokeStyle = color;
            ctx.lineWidth = width;
            ctx.lineCap = 'round';
            ctx.stroke();
        }

        function drawHeadNeckShoulderConnections(p, side, isFrontal, overlayColor) {
            const m = getHeadNeckModel(p, side, isFrontal);
            if (!m.neckBase || !m.headCenter) return;

            // Omuz köprüsü: sol omuz - boyun kökü - sağ omuz
            if (isUsable(p[11], 0.25) && isUsable(p[12], 0.25)) {
                drawThickLine(p[11], m.neckBase, '#00f2fe', 4);
                drawThickLine(m.neckBase, p[12], '#00f2fe', 4);
            } else {
                drawThickLine(side.sh, m.neckBase, '#00f2fe', 4);
            }

            // Boyun ve baş bağlantısı
            drawThickLine(m.neckBase, m.neckTop, overlayColor, 7);
            drawThickLine(m.neckTop, m.headCenter, overlayColor, 4);

            // Omurga bağlantısı: otururken kalça görünmese bile kısa gövde referansı çiz
            if (m.midHip && isUsable(m.midHip, 0.25)) {
                drawThickLine(m.midHip, m.neckBase, overlayColor, 5);
            } else {
                const pseudoSpine = { x: m.neckBase.x, y: m.neckBase.y + 0.22, visibility: 0.4 };
                drawThickLine(m.neckBase, pseudoSpine, overlayColor, 4);
            }

            // Baş çemberi, yüz ve kulak/çene bağlantıları
            const hc = lmToCanvas(m.headCenter);
            let radius = 34;
            if (isUsable(p[2], 0.25) && isUsable(p[5], 0.25)) {
                radius = Math.max(26, Math.min(70, Math.hypot(p[2].x - p[5].x, p[2].y - p[5].y) * canvas.width * 1.05));
            }
            ctx.beginPath();
            ctx.arc(hc.x, hc.y, radius, 0, Math.PI * 2);
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = 2.5;
            ctx.stroke();

            if (isUsable(p[2], 0.25) && isUsable(p[5], 0.25)) drawThickLine(p[2], p[5], '#f59e0b', 2.5);
            if (m.nose && m.eyeMid) drawThickLine(m.eyeMid, m.nose, '#f59e0b', 2);
            if (m.mouthMid && m.neckTop) drawThickLine(m.mouthMid, m.neckTop, '#f59e0b', 2.5);
            if (isUsable(p[7], 0.25) && m.neckTop) drawThickLine(p[7], m.neckTop, '#f59e0b', 2.5);
            if (isUsable(p[8], 0.25) && m.neckTop) drawThickLine(p[8], m.neckTop, '#f59e0b', 2.5);
        }

        function estimatePostureTypeFromLandmarks(p, side, isFrontal) {
            const leftHip = isUsable(p[23], 0.30) ? p[23] : null;
            const rightHip = isUsable(p[24], 0.30) ? p[24] : null;
            const leftKnee = isUsable(p[25], 0.30) ? p[25] : null;
            const rightKnee = isUsable(p[26], 0.30) ? p[26] : null;
            const leftAnkle = isUsable(p[27], 0.30) ? p[27] : null;
            const rightAnkle = isUsable(p[28], 0.30) ? p[28] : null;

            const shoulder = getMidPoint(p[11], p[12], side.sh);
            const hip = getMidPoint(p[23], p[24], side.hip);

            const visibleHips = (leftHip ? 1 : 0) + (rightHip ? 1 : 0);
            const visibleKnees = (leftKnee ? 1 : 0) + (rightKnee ? 1 : 0);
            const visibleAnkles = (leftAnkle ? 1 : 0) + (rightAnkle ? 1 : 0);
            const hasHip = !!hip;

            // BASİT VE NET MOD KURALI:
            // Bel/kalça ve aşağısı kamerada görünüyorsa AYAKTA varsay.
            // Alt beden görünmüyorsa OTURUR varsay.
            const waistAndBelowVisible = visibleHips >= 1 && (visibleKnees >= 1 || visibleAnkles >= 1);
            if (waistAndBelowVisible) {
                return {
                    type: 'standing',
                    confidence: 0.96,
                    reason: 'waist-and-below-visible',
                    standingScore: 10,
                    sittingScore: 0
                };
            }

            const lowerBodyMissing = visibleHips === 0 || (visibleKnees === 0 && visibleAnkles === 0);
            if (lowerBodyMissing) {
                return {
                    type: 'sitting',
                    confidence: 0.92,
                    reason: 'waist-and-below-not-visible',
                    standingScore: 0,
                    sittingScore: 10
                };
            }

            const torsoVertical = (shoulder && hip) ? Math.abs(hip.y - shoulder.y) : 0;
            const torsoHorizontal = (shoulder && hip) ? Math.abs(hip.x - shoulder.x) : 0;
            const torsoLeanRatio = torsoHorizontal / Math.max(torsoVertical, 0.05);

            const legs = [];
            if (leftHip && leftKnee) legs.push({ hip: leftHip, knee: leftKnee, ankle: leftAnkle, side: 'left' });
            if (rightHip && rightKnee) legs.push({ hip: rightHip, knee: rightKnee, ankle: rightAnkle, side: 'right' });
            if (legs.length === 0 && isUsable(side.hip, 0.30) && isUsable(side.knee, 0.30)) {
                legs.push({ hip: side.hip, knee: side.knee, ankle: isUsable(side.ankle, 0.30) ? side.ankle : null, side: side.label || 'active' });
            }

            let standingFullLeg = 0;
            let standingHipKnee = 0;
            let sittingThigh = 0;
            let chairLike = 0;
            let bentKnee = 0;
            let debugParts = [];

            legs.forEach(leg => {
                const hipKneeY = leg.knee.y - leg.hip.y; // + aşağı
                const hipKneeX = Math.abs(leg.knee.x - leg.hip.x);
                const hipKneeRatio = hipKneeX / Math.max(Math.abs(hipKneeY), 0.035);

                let kneeAngle = 130;
                let kneeAnkleY = 0;
                let kneeAnkleX = 0;
                let hipAnkleY = 0;

                if (leg.ankle) {
                    kneeAngle = calculateAngle(leg.hip, leg.knee, leg.ankle);
                    kneeAnkleY = leg.ankle.y - leg.knee.y;
                    kneeAnkleX = Math.abs(leg.ankle.x - leg.knee.x);
                    hipAnkleY = leg.ankle.y - leg.hip.y;
                }

                // OTURUR ÖNCELİK:
                // Otururken en kritik işaret üst bacağın yataya gitmesidir.
                // Bu sinyal varsa ayak görünse bile "oturur" daha güvenlidir.
                const thighHorizontal =
                    hipKneeX > 0.055 &&
                    Math.abs(hipKneeY) < 0.23 &&
                    hipKneeRatio > 0.45;

                const chairPattern =
                    leg.ankle &&
                    hipKneeX > 0.06 &&
                    Math.abs(hipKneeY) < 0.24 &&
                    kneeAnkleY > 0.075;

                const kneeBent =
                    leg.ankle &&
                    kneeAngle < 145 &&
                    hipKneeX > 0.035;

                // AYAKTA:
                // Ayakta saymak için mümkün olduğunca tam dikey bacak zinciri aranır.
                // Sadece kalça-diz dikeyliği ayakta demek için tek başına yeterli değildir.
                const fullLegVertical =
                    leg.ankle &&
                    hipKneeY > 0.12 &&
                    kneeAnkleY > 0.10 &&
                    hipAnkleY > 0.30 &&
                    hipKneeX < 0.18 &&
                    kneeAnkleX < 0.22 &&
                    kneeAngle > 145 &&
                    !thighHorizontal &&
                    !chairPattern;

                const hipKneeVerticalOnly =
                    hipKneeY > 0.17 &&
                    hipKneeX < 0.15 &&
                    hipKneeRatio < 0.65 &&
                    !thighHorizontal;

                if (thighHorizontal) sittingThigh++;
                if (chairPattern) chairLike++;
                if (kneeBent) bentKnee++;
                if (fullLegVertical) standingFullLeg++;
                if (hipKneeVerticalOnly) standingHipKnee++;

                debugParts.push({ hipKneeY, hipKneeX, hipKneeRatio, kneeAngle, kneeAnkleY, hipAnkleY, thighHorizontal, chairPattern, fullLegVertical, hipKneeVerticalOnly });
            });

            let standingScore = 0;
            let sittingScore = 0;

            // Oturur varsayımı daha güvenli: web kamera/kadrajda alt beden eksikse ayakta dememeli.
            if (!hasHip) sittingScore += 2.0;
            if (visibleKnees === 0) sittingScore += 0.9;
            if (visibleAnkles === 0) sittingScore += 1.1;

            if (sittingThigh >= 1) sittingScore += 3.0;
            if (sittingThigh >= 2) sittingScore += 1.0;
            if (chairLike >= 1) sittingScore += 3.2;
            if (bentKnee >= 1) sittingScore += 1.2;

            if (standingFullLeg >= 1) standingScore += 4.0;
            if (standingFullLeg >= 2) standingScore += 1.0;
            if (standingHipKnee >= 1 && visibleAnkles >= 1) standingScore += 1.2;

            // Gövde-kalça dikliği ayakta için sadece destekleyici olsun, tek başına karar vermesin.
            if (hasHip && torsoVertical > 0.20 && torsoLeanRatio < 1.0) standingScore += 0.8;
            if (hasHip && torsoVertical > 0.25 && torsoLeanRatio < 1.1) standingScore += 0.6;
            if (torsoVertical < 0.16 || torsoLeanRatio > 1.15) sittingScore += 0.5;

            // KESİN OTURUR:
            // Üst bacak yataylığı veya sandalye paterni varsa ayakta sinyalini bastır.
            if (chairLike >= 1 || sittingThigh >= 1) {
                return {
                    type: 'sitting',
                    confidence: chairLike >= 1 ? 0.96 : 0.92,
                    reason: chairLike >= 1 ? 'chair-pattern-priority' : 'horizontal-thigh-priority',
                    standingScore,
                    sittingScore
                };
            }

            // KESİN AYAKTA:
            // Ayakta demek için tam bacak zinciri gerekir.
            if (standingFullLeg >= 1 && hasHip && torsoVertical > 0.16) {
                return {
                    type: 'standing',
                    confidence: 0.93,
                    reason: 'full-vertical-leg-required',
                    standingScore,
                    sittingScore
                };
            }

            // Eğer ayak görünmüyor veya tam bacak zinciri yoksa ayakta demek yerine mevcut/oturur mod daha güvenli.
            if (visibleAnkles === 0 || standingFullLeg === 0) {
                if (postureType === 'standing' && standingHipKnee >= 1 && torsoVertical > 0.22 && sittingScore < standingScore) {
                    return {
                        type: 'standing',
                        confidence: 0.72,
                        reason: 'keep-standing-soft',
                        standingScore,
                        sittingScore
                    };
                }
                return {
                    type: 'sitting',
                    confidence: 0.84,
                    reason: 'no-full-standing-chain',
                    standingScore,
                    sittingScore
                };
            }

            const diff = Math.abs(standingScore - sittingScore);
            if (diff < 1.3) {
                return {
                    type: postureType,
                    confidence: 0.45,
                    reason: 'uncertain-keep-current',
                    standingScore,
                    sittingScore
                };
            }

            const type = standingScore > sittingScore ? 'standing' : 'sitting';
            const confidence = Math.min(0.92, 0.58 + diff * 0.10);
            return { type, confidence, reason: type === 'standing' ? 'score-standing' : 'score-sitting', standingScore, sittingScore };
        }

        function updateAutoModeBadge(guess) {
            const badge = document.getElementById('auto-mode-badge');
            if (!badge || mode !== 'posture') return;
            if (!guess) {
                badge.innerText = `AUTO MOD: ${postureType === 'standing' ? 'AYAKTA' : 'OTURUR'}`;
                return;
            }
            const label = guess.type === 'standing' ? 'AYAKTA' : 'OTURUR';
            const current = postureType === 'standing' ? 'AYAKTA' : 'OTURUR';
            const conf = Math.round((guess.confidence || 0) * 100);
            const ss = typeof guess.standingScore === 'number' ? guess.standingScore.toFixed(1) : '-';
            const si = typeof guess.sittingScore === 'number' ? guess.sittingScore.toFixed(1) : '-';
            badge.innerText = `AUTO: ${label} %${conf} | MOD: ${current}`;
        }

        function autoUpdatePostureType(p, side, isFrontal) {
            if (!autoPostureTypeEnabled || mode !== 'posture' || isModalOpen || isCalibrating) return;
            const guess = estimatePostureTypeFromLandmarks(p, side, isFrontal);
            updateAutoModeBadge(guess);
            const now = Date.now();

            const requiredConfidence = (guess.type === 'standing') ? 0.80 : 0.66;
            if (guess.confidence < requiredConfidence || guess.type === postureType) {
                postureTypeCandidate = null;
                postureTypeCandidateSince = 0;
                return;
            }

            if (postureTypeCandidate !== guess.type) {
                postureTypeCandidate = guess.type;
                postureTypeCandidateSince = now;
                return;
            }

            // Güçlü kararda daha hızlı, sınırda kararda biraz daha yavaş değiştir.
            const requiredStableMs = (guess.type === 'standing')
                ? 250
                : (guess.confidence >= 0.86 ? 250 : 450);
            if (now - postureTypeCandidateSince > requiredStableMs) {
                setPostureType(guess.type, 'auto');
                postureTypeCandidate = null;
                postureTypeCandidateSince = 0;
            }
        }

        function isStableFrontalHeadForward(isCandidate) {
            const now = Date.now();
            if (!isCandidate) {
                frontalHeadIssueSince = 0;
                frontalHeadIssueActive = false;
                return false;
            }

            if (!frontalHeadIssueActive) {
                frontalHeadIssueActive = true;
                frontalHeadIssueSince = now;
                return false;
            }

            // Önden baş öne eğilme z-koordinatında çok oynak olabilir.
            // Bu yüzden en az 900ms aynı sorun sürmeden hata saymıyoruz.
            return (now - frontalHeadIssueSince) >= 780;
        }

        function onResults(res) {
            canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight; ctx.save(); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(res.image, 0, 0, canvas.width, canvas.height);
            if (!isAppActive || isModalOpen) { ctx.restore(); return; }
            const now = Date.now(); const delta = now - lastFrameTime; lastFrameTime = now;

            if (res.poseLandmarks) {
                const p = res.poseLandmarks;
                drawConnectors(ctx, p, POSE_CONNECTIONS, { color: '#ffffff', lineWidth: 2 });
                drawLandmarks(ctx, p, { color: '#00f2fe', lineWidth: 1, radius: 4 });

                let isGood = true, isVisible = true, isSetupError = false, warningText = "";
                let rawVal = 0, shoulderTilt = 0, finalVal = 0, spineFrontalOffset = 0, spineLateralAngle = 0, hasSpineMeasurement = false;
                let shoulderLevelOffset = 0, shoulderCenterOffset = 0, shoulderStackAngle = 0, shoulderLevelDeg = 0, hasShoulderCenter = false, hasLateralShoulderStack = false;
                let lateralSideModel = null;
                let shoulderDepthDiff3D = 0, spineDepthOffset3D = 0, headForwardDepth3D = 0, hasShoulderDepth3D = false, hasSpineDepth3D = false, hasHeadDepth3D = false;
                window.currentFrontalNeckCompression = 1;
                let leftFaceVisible = (p[2] && p[2].visibility > 0.45) || (p[7] && p[7].visibility > 0.45);
                let rightFaceVisible = (p[5] && p[5].visibility > 0.45) || (p[8] && p[8].visibility > 0.45);
                let side = getActiveSide(p); // Aktif taraf koordinatları

                // Ön/yan ayrımı: sadece yüz noktaları yeterli değil.
                // Yan duruşta iki yüz landmark'ı kısa süre görünebilir ve yanlışlıkla "ön profil" sayılabilir.
                const bothShouldersVisible = isUsable(p[11], 0.35) && isUsable(p[12], 0.35);
                const shoulderSpanForView = bothShouldersVisible ? Math.hypot(p[11].x - p[12].x, p[11].y - p[12].y) : 0;
                const shoulderDepthForView = (bothShouldersVisible && hasDepth(p[11]) && hasDepth(p[12])) ? Math.abs(p[11].z - p[12].z) : 0;
                const sideViewConfidence = side.confidence || 0;

                let isFrontal = leftFaceVisible && rightFaceVisible && bothShouldersVisible && shoulderSpanForView > 0.13 && sideViewConfidence < 0.34;

                // Ayakta yan duruşta kameraya paralel/ön profil uyarıları verilmesin.
                // Eğer aktif taraf belirginse bu görüntü yan profil kabul edilir.
                if (mode === 'posture' && postureType === 'standing' && sideViewConfidence > 0.22) {
                    isFrontal = false;
                }

                autoUpdatePostureType(p, side, isFrontal);

                // -------------------------------------------------------------
                // 1. MUTLAK DOĞRULUK: ÖN-ŞART KONTROLLERİ (PREREQUISITE CHECKS)
                // Y-Ekseni Tespiti (Canvas'ta 0 en üst, 1 en alttır)
                // -------------------------------------------------------------
                if (mode === 'posture') {
                    const model = getHeadNeckModel(p, side, isFrontal);
                    const hasShoulder = isUsable(p[11], 0.35) || isUsable(p[12], 0.35) || isUsable(side.sh, 0.35);
                    const hasHead = isUsable(model.headCenter, 0.30) || isUsable(p[0], 0.30) || isUsable(side.ear, 0.30);

                    if (!hasShoulder || !hasHead) {
                        isVisible = false;
                    } else {
                        // Oturur analizde kalça/bacak görünmeyebilir; bunu hata sayma.
                        // Otomatik mod seçici artık ayakta/oturur ayrımını kendisi yapıyor.
                        // Sadece kalça görünmüyor diye doğrudan oturur moda geçmiyoruz.
                        if (postureType === 'standing' && checkVisibility([side.hip]) && side.hip.y < side.sh.y) {
                            isSetupError = true;
                            warningText = getVariantWarning('setup-upright', ["Lütfen dik pozisyon alın.", "Duruşunuzu toparlayıp dik konuma geçin.", "Analiz için biraz daha dik durun."]);
                        } else if (postureType === 'standing' && !isFrontal && (!isUsable(side.hip, 0.24) && !isUsable(side.knee, 0.24))) {
                            isSetupError = true;
                            warningText = getVariantWarning('setup-standing-visible', [`${side.tr || 'Yan'} ayakta analiz için gövde ve bacak hattı kamerada görünmeli. Biraz geriye çekilin.`, `${side.tr || 'Yan'} profil analizinde bacaklarınız da görünmeli. Kameradan biraz uzaklaşın.`, `${side.tr || 'Yan'} ayakta ölçüm için alt beden görünmüyor. Biraz geriye gidin.`]);
                        }
                    }
                }
                else if (mode === 'doorway') {
                    if (!checkVisibility([p[11], p[13]])) isVisible = false;
                    else if (p[23].y < p[11].y) { isSetupError = true; warningText = getVariantWarning('setup-stand-up', ["Ayakta değilsiniz! Lütfen ayağa kalkın.", "Bu mod için ayakta durmanız gerekiyor. Lütfen ayağa kalkın.", "Sistem sizi ayakta algılamıyor. Ayağa kalkıp tekrar deneyin."]); }
                    else if (isFrontal === false) { isSetupError = true; warningText = getVariantWarning('setup-front', ["Lütfen kameraya ÖNDEN dönün.", "Doğru analiz için yüzünüzü kameraya çevirin.", "Ön profil gerekli. Kameraya karşı dönün."]); }
                }
                else if (mode === 'catcow') {
                    if (!checkVisibility([side.sh, side.hip, side.wr])) isVisible = false;
                    else if (isFrontal) { isSetupError = true; warningText = getVariantWarning('setup-side', ["Hareketi ölçebilmem için kameraya YAN dönmelisiniz.", "Doğru ölçüm için profil duruşa geçin.", "Lütfen kameraya yan dönerek pozisyon alın."]); }
                    else if (Math.abs(side.sh.y - side.hip.y) > 0.35) { isSetupError = true; warningText = getVariantWarning('setup-crawl', ["Emekleme pozisyonunda değilsiniz (Sırtınız yere paralel değil).", "Sırtınız yere paralel olmalı. Emekleme pozisyonunu düzeltin.", "Pozisyon tam değil. Dört ayak duruşunda sırtı düzleyin."]); }
                }
                else if (mode === 'birddog') {
                    if (!checkVisibility([side.sh, side.hip, side.wr])) isVisible = false;
                    else if (isFrontal) { isSetupError = true; warningText = getVariantWarning('setup-side', ["Hareketi ölçebilmem için kameraya YAN dönmelisiniz.", "Doğru ölçüm için profil duruşa geçin.", "Lütfen kameraya yan dönerek pozisyon alın."]); }
                    else if (Math.abs(side.sh.y - side.hip.y) > 0.35) { isSetupError = true; warningText = getVariantWarning('setup-crawl', ["Emekleme pozisyonunda değilsiniz (Sırtınız yere paralel değil).", "Sırtınız yere paralel olmalı. Emekleme pozisyonunu düzeltin.", "Pozisyon tam değil. Dört ayak duruşunda sırtı düzleyin."]); }
                }
                else if (mode === 'plank') {
                    if (!checkVisibility([side.sh, side.hip, side.ankle])) isVisible = false;
                    else if (isFrontal) { isSetupError = true; warningText = getVariantWarning('setup-plank-side', ["Plank için kameraya tam YAN dönmelisiniz.", "Plank analizinde profil görünüm gerekli. Yan dönün.", "Plank ölçümü için kameraya tam yan konum alın."]); }
                    else if (Math.abs(side.sh.y - side.hip.y) > 0.35) { isSetupError = true; warningText = getVariantWarning('setup-plank', ["Plank pozisyonunda değilsiniz (Vücut yere paralel değil).", "Plank duruşunuz tam değil. Vücudu düz bir çizgiye getirin.", "Plank için gövde yere paralel olmalı. Pozisyonu düzeltin."]); }
                }
                else if (mode === 'bridge') {
                    if (!checkVisibility([side.sh, side.hip, side.knee])) isVisible = false;
                    else if (isFrontal) { isSetupError = true; warningText = getVariantWarning('setup-bridge-side', ["Köprü için kameraya YAN dönmelisiniz.", "Köprü hareketi için profil açı gerekli. Yan dönün.", "Köprü analizinde sizi yandan görmem gerekiyor. Yan pozisyon alın."]); }
                    // Omuzlar yerde (y ekseninde aşağıda büyük sayı), dizler havada (küçük sayı) olmalı
                    else if (side.sh.y < side.knee.y) { isSetupError = true; warningText = getVariantWarning('setup-supine', ["Sırtüstü yatar pozisyonda değilsiniz.", "Köprü için sırtüstü başlangıç pozisyonuna geçin.", "Analiz için sırtüstü yatar duruşta olmalısınız."]); }
                }

                // -------------------------------------------------------------
                // 2. FORM ANALİZİ VE AÇI HESAPLARI (Ön-şartlar sağlandıysa çalışır)
                // -------------------------------------------------------------
                if (isVisible && !isSetupError) {
                    if (mode === 'posture') {
                        if (isFrontal) {
                            const model = getHeadNeckModel(p, side, isFrontal);
                            if (!model.midShoulder || !model.headCenter) {
                                isVisible = false;
                            } else {
                                let shoulderSpan = (isUsable(p[11], 0.25) && isUsable(p[12], 0.25)) ? Math.abs(p[11].x - p[12].x) : 0.18;
                                let eyeWidth = (isUsable(p[2], 0.25) && isUsable(p[5], 0.25)) ? Math.hypot(p[2].x - p[5].x, p[2].y - p[5].y) : shoulderSpan * 0.36;
                                let scaleBase = Math.max(eyeWidth, shoulderSpan * 0.30, 0.035);
                                let verticalDist = model.midShoulder.y - model.headCenter.y;
                                rawVal = verticalDist / scaleBase;
                                // Önden boyun öne eğilme / baş-boyun sıkışması:
                                // Kişi boynunu öne kırdığında baş-omuz düşey mesafesi azalır.
                                window.currentFrontalNeckCompression = rawVal / Math.max(((postureType === 'sitting') ? limits.postureSittingFrontalRatio : limits.postureFrontalRatio), 0.1);
                                shoulderTilt = (isUsable(p[11], 0.35) && isUsable(p[12], 0.35)) ? Math.abs(p[11].y - p[12].y) : 0;
                                const spineModel = getSpinePostureModel(p, side, isFrontal);
                                hasSpineMeasurement = spineModel.hasRealHip && spineModel.confidence > 0.58;
                                spineFrontalOffset = spineModel.frontalOffset;
                                const shoulderAlign = getShoulderAlignmentModel(p, side, isFrontal);
                                shoulderLevelOffset = shoulderAlign.levelOffset;
                                shoulderLevelDeg = shoulderAlign.levelDeg;
                                shoulderCenterOffset = shoulderAlign.centerOffset;
                                hasShoulderCenter = !!shoulderAlign.centerTarget;
                                const depthModel = getDepthPostureModel(p, side, isFrontal);
                                shoulderDepthDiff3D = depthModel.shoulderDepthDiff;
                                spineDepthOffset3D = depthModel.spineDepthOffset;
                                headForwardDepth3D = depthModel.headForwardDepth;
                                hasShoulderDepth3D = depthModel.hasShoulderDepth;
                                hasSpineDepth3D = depthModel.hasSpineDepth;
                                hasHeadDepth3D = depthModel.hasHeadDepth;
                            }
                        } else {
                            lateralSideModel = getLateralSidePostureModel(p, side, isFrontal);
                            rawVal = lateralSideModel.hasHead ? lateralSideModel.headForwardAngle : 0;
                            const spineModel = getSpinePostureModel(p, side, isFrontal);
                            hasSpineMeasurement = spineModel.hasRealHip && spineModel.confidence > 0.58;
                            spineLateralAngle = spineModel.lateralAngle;
                            const shoulderAlign = getShoulderAlignmentModel(p, side, isFrontal);
                            shoulderStackAngle = shoulderAlign.stackAngle;
                            hasLateralShoulderStack = shoulderAlign.hasLateralStack;
                            const depthModel = getDepthPostureModel(p, side, isFrontal);
                            shoulderDepthDiff3D = depthModel.shoulderDepthDiff;
                            spineDepthOffset3D = depthModel.spineDepthOffset;
                            headForwardDepth3D = depthModel.headForwardDepth;
                            hasShoulderDepth3D = depthModel.hasShoulderDepth;
                            hasSpineDepth3D = depthModel.hasSpineDepth;
                            hasHeadDepth3D = depthModel.hasHeadDepth;
                        }
                    }
                    else if (mode === 'doorway') { rawVal = Math.abs(p[11].y - p[13].y); }
                    else if (mode === 'catcow') { rawVal = calculateAngle(side.sh, side.el, side.wr); } // Dirsek açısı
                    else if (mode === 'birddog') { rawVal = p[23].y - p[27].y; } // Çapraz bacak yüksekliği
                    else if (mode === 'plank') { rawVal = calculateAngle(side.sh, side.hip, side.ankle); } // Omuz-Kalça-Topuk açısı
                    else if (mode === 'bridge') { rawVal = calculateAngle(side.sh, side.hip, side.knee); } // Omuz-Kalça-Diz açısı

                    // EMA TİTREŞİM FİLTRESİ
                    if (emaVal === null) emaVal = rawVal;
                    emaVal = (0.20 * rawVal) + (0.80 * emaVal);
                    finalVal = emaVal;

                    // LİMİT KONTROLLERİ (MUTLAK DOĞRULUK)
                    if (mode === 'posture') {
                        if (isFrontal) {
                            const activeFrontalLimit = (postureType === 'sitting') ? limits.postureSittingFrontalRatio : limits.postureFrontalRatio;
                            const activeShoulderLevelLimit = (postureType === 'sitting') ? limits.postureSittingShoulderLevel : limits.postureShoulderLevel;
                            const activeShoulderCenterLimit = (postureType === 'sitting') ? limits.postureSittingShoulderCenter : limits.postureShoulderCenter;
                            const activeShoulderDepthLimit = (postureType === 'sitting') ? limits.postureSittingShoulderDepthFrontal : limits.postureShoulderDepthFrontal;
                            const activeSpineDepthLimit = (postureType === 'sitting') ? limits.postureSittingSpineDepthFrontal : limits.postureSpineDepthFrontal;
                            if (shoulderLevelOffset > activeShoulderLevelLimit) { isGood = false; warningText = "Hata: Omuz hizanız bozuk. Sağ ve sol omuzu aynı seviyeye getirin."; }
                            else if (hasShoulderCenter && shoulderCenterOffset > activeShoulderCenterLimit) { isGood = false; warningText = "Hata: Omuz merkeziniz baş/omurga hattından kaymış. Omuzlarınızı ortalayın."; }
                            else if (isFrontal && postureType !== 'standing' && hasShoulderDepth3D && shoulderDepthDiff3D > activeShoulderDepthLimit) { isGood = false; warningText = "3D Uyarı: Ön profil için gövde simetriniz bozuk. Omuzları eşitleyin."; }
                            else if (hasSpineDepth3D && spineDepthOffset3D > activeSpineDepthLimit) { isGood = false; warningText = "3D Uyarı: Omurganız belirgin şekilde öne geliyor. Göğsü açıp gövdeyi geriye alın."; }
                            else {
                                const frontalHeadLimit = (postureType === 'sitting') ? limits.postureSittingFrontalHeadForwardDepth : limits.postureFrontalHeadForwardDepth;
                                const frontalCompressionLimit = (postureType === 'sitting') ? limits.postureSittingFrontalNeckCompressionRatio : limits.postureFrontalNeckCompressionRatio;
                                const frontalHeadDepthBad = hasHeadDepth3D && headForwardDepth3D > frontalHeadLimit;
                                const frontalNeckCompressionSevere = window.currentFrontalNeckCompression < frontalCompressionLimit;
                                const frontalNeckCompressionModerate = window.currentFrontalNeckCompression < 0.88;
                                const frontalDepthAndCompressionBad = frontalHeadDepthBad && frontalNeckCompressionModerate;

                                // Dengeli kontrol:
                                // Normal dik duruşta tek başına küçük z-depth oynaması uyarı vermez.
                                // Boyun gerçekten öne kapanıyorsa sıkışma skoru düşer; z-depth de eşlik ederse daha güvenli algılanır.
                                if (isStableFrontalHeadForward(frontalNeckCompressionSevere || frontalDepthAndCompressionBad)) {
                                    isGood = false;
                                    warningText = (postureType === 'sitting')
                                        ? "Önden uyarı: Boynunuz/başınız belirgin şekilde öne düşüyor. Çeneyi hafif geriye alın ve boynu uzatın."
                                        : "Önden uyarı: Boynunuz belirgin şekilde öne eğilmiş. Çeneyi hafif geriye alın, baş-boyun hattını dikleştirin.";
                                }
                                else if (finalVal < activeFrontalLimit) {
                                    isGood = false;
                                    warningText = (postureType === 'sitting') ? "Otururken baş-boyun-omuz hattınızı dik tutun." : "Başınız önde veya kambur duruyorsunuz, dikleşin.";
                                }
                                else if (isUsable(p[2], 0.35) && isUsable(p[5], 0.35)) {
                                    let headTiltDeg = Math.round(Math.atan2(Math.abs(p[2].y - p[5].y), Math.abs(p[2].x - p[5].x)) * (180 / Math.PI));
                                    if (headTiltDeg > limits.postureHeadTilt) {
                                        isGood = false;
                                        warningText = "Hata: Başınız yana eğik, düzeltin.";
                                    }
                                }
                            }
                            if (isGood && hasSpineMeasurement) {
                                const activeSpineLimit = (postureType === 'standing')
                                    ? limits.postureStandingFrontalSpineCurve
                                    : ((postureType === 'sitting') ? limits.postureSittingSpineFrontal : limits.postureSpineFrontal);
                                if (spineFrontalOffset > activeSpineLimit) {
                                    isGood = false;
                                    warningText = (postureType === 'standing')
                                        ? "Ayakta omurga hatası: Omurga hattınız yana kaymış/eğri görünüyor. Baş, omuz ve bel hattını ortalayın."
                                        : "Hata: Omurga hattınız yana kaymış. Baş, omuz ve bel hizasını ortalayın.";
                                }
                            }
                        } else {
                            const sideCheck = lateralSideModel || getLateralSidePostureModel(p, side, isFrontal);
                            const sideName = sideCheck.sideName;
                            const sideLimits = sideCheck.sideLimits;
                            const activeHeadLimit = sideLimits.headForward || limits.postureLateral;
                            const activeShoulderStackLimit = sideLimits.shoulderStack || ((postureType === 'sitting') ? limits.postureSittingShoulderStackLateral : limits.postureShoulderStackLateral);
                            const activeSpineSideLimit = (postureType === 'sitting') ? sideLimits.spineSitting : sideLimits.spineStanding;
                            const standingChain = sideCheck.standingChain || getStandingSideChainModel(p, side, isFrontal);

                            const stableStandingError = getStableStandingSideError(standingChain);

                            if (postureType === 'standing' && stableStandingError) {
                                isGood = false;
                                warningText = stableStandingError;
                            }
                            else if (postureType !== 'standing' && sideCheck.hasHead && finalVal > activeHeadLimit) {
                                isGood = false;
                                warningText = `${sideName} hatası: Başınız önde. Çenenizi geriye çekip boynu uzatın.`;
                            }
                            else if (hasHeadDepth3D && headForwardDepth3D > ((postureType === 'sitting') ? limits.postureSittingHeadDepthForward : limits.postureHeadDepthForward)) {
                                isGood = false;
                                warningText = `${sideName} 3D uyarısı: Başınız belirgin şekilde boyun hattının önüne geliyor.`;
                            }
                            else if (postureType !== 'standing' && sideCheck.hasShoulderHip && Math.abs(sideCheck.shoulderHipAngle) > activeShoulderStackLimit) {
                                isGood = false;
                                warningText = sideCheck.shoulderHipAngle > 0
                                    ? `${sideName} hatası: Omzunuz kalça hattının önünde. Göğsü açıp omzu geriye alın.`
                                    : `${sideName} hatası: Omzunuz kalça hattının gerisinde. Gövdeyi merkeze alın.`;
                            }
                            else if (postureType !== 'standing' && sideCheck.hasSpine && Math.abs(sideCheck.spineAngle) > activeSpineSideLimit) {
                                isGood = false;
                                warningText = sideCheck.spineAngle > 0
                                    ? `${sideName} hatası: Omurga hattınız öne eğik. Göğsünüzü açıp dikleşin.`
                                    : `${sideName} hatası: Omurga hattınız geriye fazla yatmış. Merkeze dönün.`;
                            }
                            else if (postureType === 'sitting' && sideCheck.hasLowerBody && Math.abs(sideCheck.hipKneeStackAngle) > 30) {
                                isGood = false;
                                warningText = `${sideName} oturuş hatası: Kalça-diz hattınız bozuk. Dizleri ve kalçayı hizalayın.`;
                            }
                        }
                    }
                    else if (mode === 'doorway') { if (finalVal > limits.doorway) { isGood = false; warningText = getVariantWarning('doorway-elbow', ["Dirsekleri omuz hizasına tam kaldırın.", "Dirseklerinizi biraz daha yukarı alıp omuz hizasına getirin.", "Eşik esnemede kollar omuz hizasında olmalı. Dirsekleri yükseltin."]); } }
                    else if (mode === 'catcow') { if (finalVal < limits.catcow) { isGood = false; warningText = getVariantWarning('catcow-arms', ["Hata: Kollarınızı bükmeyin, dirsekleri dümdüz kilitleyin.", "Kedi-inek hareketinde dirsekleri bükmeyin. Kolları düz tutun.", "Kollarınız esniyor. Dirsekleri tam uzatın."]); } }
                    else if (mode === 'birddog') { if (finalVal < limits.birddog * -1) { isGood = false; warningText = getVariantWarning('birddog-leg', ["Hata: Arka bacağınızı kalça hizasına kadar tam uzatın.", "Arka bacağı biraz daha uzatıp kalça hizasına getirin.", "Kuş-köpekte arka bacak yeterince açılmamış. Tam uzatın."]); } }
                    else if (mode === 'plank') {
                        if (finalVal < limits.plankMin) { isGood = false; warningText = getVariantWarning('plank-low', ["Hata: Kalçanızı düşürmeyin, vücudunuz dümdüz olmalı.", "Plankta kalça aşağı düşüyor. Gövdeyi düz çizgide tutun.", "Kalçayı biraz yukarı alıp vücudu hizalayın."]); }
                        else if (finalVal > limits.plankMax) { isGood = false; warningText = getVariantWarning('plank-high', ["Hata: Kalçanızı çok kaldırdınız, aşağı indirin.", "Plankta kalça fazla yukarıda. Biraz aşağı indirin.", "Gövde çadır gibi olmuş. Kalçayı daha nötr seviyeye alın."]); }
                    }
                    else if (mode === 'bridge') {
                        if (finalVal < limits.bridgeMin) { isGood = false; warningText = getVariantWarning('bridge-low', ["Hata: Kalçanızı yeterince yukarı itmediniz. Daha yükseğe kaldırın.", "Köprü hareketinde kalçayı biraz daha yukarı itin.", "Kalça kaldırışı yetersiz. Köprüde daha yüksek pozisyona çıkın."]); }
                    }

                    // Çoklu uyarı toplayıcı: aynı anda birden fazla hata varsa tek mesaja kilitlenme.
                    // Ekranda yine tek ana mesaj görünür; sesli uyarı ise adaylar arasında sırayla döner.
                    if (mode === 'posture') {
                        const warningCandidates = [];
                        const addWarning = (condition, text) => { if (condition && text) warningCandidates.push(text); };
                        const addWarningVariant = (condition, key, messages) => addVariantWarning(condition, key, messages, warningCandidates);

                        if (isFrontal) {
                            const activeFrontalLimit = (postureType === 'sitting') ? limits.postureSittingFrontalRatio : limits.postureFrontalRatio;
                            const activeShoulderLevelLimit = (postureType === 'sitting') ? limits.postureSittingShoulderLevel : limits.postureShoulderLevel;
                            const activeShoulderCenterLimit = (postureType === 'sitting') ? limits.postureSittingShoulderCenter : limits.postureShoulderCenter;
                            const activeShoulderDepthLimit = (postureType === 'sitting') ? limits.postureSittingShoulderDepthFrontal : limits.postureShoulderDepthFrontal;
                            const activeSpineDepthLimit = (postureType === 'sitting') ? limits.postureSittingSpineDepthFrontal : limits.postureSpineDepthFrontal;
                            const frontalHeadLimit = (postureType === 'sitting') ? limits.postureSittingFrontalHeadForwardDepth : limits.postureFrontalHeadForwardDepth;
                            const frontalCompressionLimit = (postureType === 'sitting') ? limits.postureSittingFrontalNeckCompressionRatio : limits.postureFrontalNeckCompressionRatio;
                            const frontalHeadDepthBad = hasHeadDepth3D && headForwardDepth3D > frontalHeadLimit;
                            const frontalNeckCompressionBad = window.currentFrontalNeckCompression < frontalCompressionLimit || (frontalHeadDepthBad && window.currentFrontalNeckCompression < 0.88);
                            let frontalHeadTiltBad = false;
                            if (isUsable(p[2], 0.35) && isUsable(p[5], 0.35)) {
                                const headTiltDegNow = Math.round(Math.atan2(Math.abs(p[2].y - p[5].y), Math.abs(p[2].x - p[5].x)) * (180 / Math.PI));
                                frontalHeadTiltBad = headTiltDegNow > limits.postureHeadTilt;
                            }
                            const activeSpineLimit = (postureType === 'standing')
                                ? limits.postureStandingFrontalSpineCurve
                                : ((postureType === 'sitting') ? limits.postureSittingSpineFrontal : limits.postureSpineFrontal);

                            addWarningVariant(shoulderLevelOffset > activeShoulderLevelLimit, 'shoulder-level', [
                                "Hata: Omuz hizanız bozuk. Sağ ve sol omuzu aynı seviyeye getirin.",
                                "Uyarı: Omuzlar eşit görünmüyor. Omuz seviyesini dengeleyin.",
                                "Omuzlarınızdan biri daha yukarıda. İki omzu aynı hizada tutun."
                            ]);
                            addWarningVariant(hasShoulderCenter && shoulderCenterOffset > activeShoulderCenterLimit, 'shoulder-center', [
                                "Hata: Omuz merkeziniz baş/omurga hattından kaymış. Omuzlarınızı ortalayın.",
                                "Uyarı: Omuz hattınız merkezden kaçmış. Gövdeyi ortalayın.",
                                "Omuzlarınız merkezden sapmış görünüyor. Baş ve gövde hizasına geri dönün."
                            ]);
                            addWarningVariant(postureType !== 'standing' && hasShoulderDepth3D && shoulderDepthDiff3D > activeShoulderDepthLimit, 'shoulder-depth', [
                                "3D Uyarı: Ön profil için gövde simetriniz bozuk. Omuzları eşitleyin.",
                                "3D Uyarı: Omuz derinliği eşit değil. Gövdeyi daha simetrik tutun.",
                                "Önden duruşta omuzlarınız aynı hatta değil. Simetriyi düzeltin."
                            ]);
                            addWarningVariant(hasSpineDepth3D && spineDepthOffset3D > activeSpineDepthLimit, 'spine-depth', [
                                "3D Uyarı: Omurganız belirgin şekilde öne geliyor. Göğsü açıp gövdeyi geriye alın.",
                                "3D Uyarı: Üst gövdeniz fazla öne taşmış. Dikleşip göğsü açın.",
                                "Omurga hattınız öne kapanıyor. Sırtı uzatıp gövdeyi toparlayın."
                            ]);
                            addWarningVariant(frontalNeckCompressionBad, 'frontal-neck', postureType === 'sitting'
                                ? [
                                    "Önden uyarı: Boynunuz/başınız belirgin şekilde öne düşüyor. Çeneyi hafif geriye alın ve boynu uzatın.",
                                    "Oturuş uyarısı: Başınız öne kaymış. Enseyi uzatıp çeneyi biraz geriye alın.",
                                    "Boyun hattınız kısalmış görünüyor. Başınızı merkeze alıp boynu uzatın."
                                ]
                                : [
                                    "Önden uyarı: Boynunuz belirgin şekilde öne eğilmiş. Çeneyi hafif geriye alın, baş-boyun hattını dikleştirin.",
                                    "Baş-boyun hattınız öne kapanıyor. Çeneyi geriye alıp enseyi uzatın.",
                                    "Boyun postürünüz öne düşmüş. Başınızı omuz çizgisine yaklaştırın."
                                ]);
                            addWarningVariant(finalVal < activeFrontalLimit, 'frontal-head-posture', postureType === 'sitting'
                                ? [
                                    "Otururken baş-boyun-omuz hattınızı dik tutun.",
                                    "Oturuş uyarısı: Baş, boyun ve omuz hattını toparlayın.",
                                    "Otururken gövdeyi dikleştirin, baş ve omuzları hizalayın."
                                ]
                                : [
                                    "Başınız önde veya kambur duruyorsunuz, dikleşin.",
                                    "Baş-boyun hattınız öne kapanıyor. Göğsü açıp dik durun.",
                                    "Kamburlaşma algılandı. Başınızı toparlayıp omurgayı uzatın."
                                ]);
                            addWarningVariant(frontalHeadTiltBad, 'head-tilt', [
                                "Hata: Başınız yana eğik, düzeltin.",
                                "Başınız bir yana kayıyor. Kafayı orta hatta alın.",
                                "Boyun hizanız eğilmiş görünüyor. Başınızı düz konuma getirin."
                            ]);
                            addWarningVariant(hasSpineMeasurement && spineFrontalOffset > activeSpineLimit, 'frontal-spine', postureType === 'standing'
                                ? [
                                    "Ayakta omurga hatası: Omurga hattınız yana kaymış/eğri görünüyor. Baş, omuz ve bel hattını ortalayın.",
                                    "Ayakta duruşta omurganız yana kaçıyor. Gövdeyi merkezde toplayın.",
                                    "Omurga çizginiz düz değil. Baş, omuz ve beli aynı hatta getirin."
                                ]
                                : [
                                    "Hata: Omurga hattınız yana kaymış. Baş, omuz ve bel hizasını ortalayın.",
                                    "Oturuşta omurganız yana eğiliyor. Gövdeyi merkeze alın.",
                                    "Omurga hizanız simetrik değil. Baş ve omuzları bel hattına ortalayın."
                                ]);
                        } else {
                            const sideCheck = lateralSideModel || getLateralSidePostureModel(p, side, isFrontal);
                            const sideName = sideCheck.sideName;
                            const sideLimits = sideCheck.sideLimits;
                            const activeHeadLimit = sideLimits.headForward || limits.postureLateral;
                            const activeShoulderStackLimit = sideLimits.shoulderStack || ((postureType === 'sitting') ? limits.postureSittingShoulderStackLateral : limits.postureShoulderStackLateral);
                            const activeSpineSideLimit = (postureType === 'sitting') ? sideLimits.spineSitting : sideLimits.spineStanding;
                            const standingChain = sideCheck.standingChain || getStandingSideChainModel(p, side, isFrontal);

                            addWarning(postureType === 'standing' && !!standingChain.primaryError, standingChain.primaryError);
                            addWarningVariant(postureType !== 'standing' && sideCheck.hasHead && finalVal > activeHeadLimit, 'side-head-forward-' + sideName, [
                                `${sideName} hatası: Başınız önde. Çenenizi geriye çekip boynu uzatın.`,
                                `${sideName} uyarısı: Baş-boyun hattınız öne düşmüş. Enseyi uzatın.`,
                                `${sideName} duruş hatası: Başınız omuz çizgisinin önüne kaymış. Başınızı geri toparlayın.`
                            ]);
                            addWarningVariant(hasHeadDepth3D && headForwardDepth3D > ((postureType === 'sitting') ? limits.postureSittingHeadDepthForward : limits.postureHeadDepthForward), 'side-head-depth-' + sideName, [
                                `${sideName} 3D uyarısı: Başınız belirgin şekilde boyun hattının önüne geliyor.`,
                                `${sideName} 3D uyarısı: Baş öne taşmış görünüyor. Boyun hattını geri alın.`,
                                `${sideName} profil uyarısı: Başınız fazla önde. Baş-boyun çizgisini toparlayın.`
                            ]);
                            addWarningVariant(postureType !== 'standing' && sideCheck.hasShoulderHip && Math.abs(sideCheck.shoulderHipAngle) > activeShoulderStackLimit, sideCheck.shoulderHipAngle > 0 ? 'side-shoulder-forward-' + sideName : 'side-shoulder-back-' + sideName, sideCheck.shoulderHipAngle > 0
                                ? [
                                    `${sideName} hatası: Omzunuz kalça hattının önünde. Göğsü açıp omzu geriye alın.`,
                                    `${sideName} uyarısı: Omuz fazla öne gelmiş. Omzu geriye taşıyın.`,
                                    `${sideName} duruş hatası: Omuzunuz gövdenin önüne çıkmış. Göğsü açın.`
                                ]
                                : [
                                    `${sideName} hatası: Omzunuz kalça hattının gerisinde. Gövdeyi merkeze alın.`,
                                    `${sideName} uyarısı: Omzunuz fazla geride kalmış. Gövdeyi nötr konuma getirin.`,
                                    `${sideName} duruş hatası: Omuzunuz arkaya kaçmış. Merkeze dönün.`
                                ]);
                            addWarningVariant(postureType !== 'standing' && sideCheck.hasSpine && Math.abs(sideCheck.spineAngle) > activeSpineSideLimit, sideCheck.spineAngle > 0 ? 'side-spine-forward-' + sideName : 'side-spine-back-' + sideName, sideCheck.spineAngle > 0
                                ? [
                                    `${sideName} hatası: Omurga hattınız öne eğik. Göğsünüzü açıp dikleşin.`,
                                    `${sideName} uyarısı: Gövdeniz öne kapanıyor. Omurgayı uzatın.`,
                                    `${sideName} profil hatası: Sırtınız öne eğilmiş. Dik duruşa dönün.`
                                ]
                                : [
                                    `${sideName} hatası: Omurga hattınız geriye fazla yatmış. Merkeze dönün.`,
                                    `${sideName} uyarısı: Gövdeniz geriye fazla kaymış. Nötr duruşa dönün.`,
                                    `${sideName} profil hatası: Omurga çizginiz arkaya yatıyor. Merkeze alın.`
                                ]);
                            addWarningVariant(postureType === 'sitting' && sideCheck.hasLowerBody && Math.abs(sideCheck.hipKneeStackAngle) > 30, 'hip-knee-' + sideName, [
                                `${sideName} oturuş hatası: Kalça-diz hattınız bozuk. Dizleri ve kalçayı hizalayın.`,
                                `${sideName} uyarısı: Kalça ve diz hizanız kaçmış. Alt gövdeyi toparlayın.`,
                                `${sideName} oturuş uyarısı: Diz ve kalça hattını daha dengeli konumlandırın.`
                            ]);
                        }

                        if (warningCandidates.length > 0) {
                            isGood = false;
                            warningText = pickRotatingWarning(warningCandidates);
                            window.currentWarningCandidates = warningCandidates;
                        } else {
                            window.currentWarningCandidates = [];
                        }
                    }

                    // Kalibrasyon Modu Aktifse
                    if (isCalibrating === "CAPTURE") {
                        tempCalibData.push(finalVal);
                        if (tempCalibData.length >= 10) {
                            let avg = tempCalibData.reduce((a, b) => a + b, 0) / tempCalibData.length;
                            if (mode === 'posture') { 
                                if (activeCalibType === "frontal") {
                                    if (postureType === 'sitting') limits.postureSittingFrontalRatio = avg * 0.78; else limits.postureFrontalRatio = avg * 0.84; // oturur/ayakta ön profil toleransı
                                } else if (activeCalibType === "rightLateral") {
                                    limits.postureLateralHeadForwardRight = avg + 4;
                                    limits.postureLateral = Math.max(limits.postureLateral, avg + 4);
                                } else if (activeCalibType === "leftLateral") {
                                    limits.postureLateralHeadForwardLeft = avg + 4;
                                    limits.postureLateral = Math.max(limits.postureLateral, avg + 4);
                                } else {
                                    limits.postureLateral = avg + 4; 
                                }
                            }
                            else if (mode === 'catcow') limits.catcow = avg - 10;
                            else if (mode === 'bridge') limits.bridgeMin = avg - 15;
                            else if (mode === 'plank') { limits.plankMin = avg - 10; limits.plankMax = avg + 10; }
                            isCalibrating = false; activeCalibType = ""; emaVal = null;
                        }
                    }
                }

                // --- GELİŞMİŞ GÖRSEL REHBER VE AÇI ÇİZİMLERİ ---
                if (res.poseLandmarks) {
                    // Renk sadece form kararı verildikten sonra hesaplanır; böylece overlayColor kapsam hatası oluşmaz.
                    let overlayColor = '#94a3b8'; // Varsayılan gri (analize hazır değil / vücut tam görünmüyor)
                    if (isVisible && !isSetupError) {
                        overlayColor = isGood ? '#00e676' : '#ff3d00'; // Yeşil (iyi) veya Kırmızı (hatalı)
                    } else if (isSetupError) {
                        overlayColor = '#f59e0b'; // Turuncu (pozisyon hatası / ön şart uyarısı)
                    }
                    
                    if (mode === 'posture') {
                        drawHeadNeckShoulderConnections(p, side, isFrontal, overlayColor);
                        drawShoulderAlignmentGuide(p, side, isFrontal, overlayColor);
                        drawLateralSidePostureGuide(p, side, isFrontal, overlayColor);
                        drawSpinePostureChain(p, side, isFrontal, overlayColor);
                        if (isFrontal) {
                            // Ön cephe omuz çizgisi ve baş hizası çizimi
                            if (p[11] && p[12]) {
                                let sh1Val = p[11];
                                let sh2Val = p[12];
                                
                                let sh1 = { x: sh1Val.x * canvas.width, y: sh1Val.y * canvas.height };
                                let sh2 = { x: sh2Val.x * canvas.width, y: sh2Val.y * canvas.height };
                                
                                // Omuz simetri fall-back'i (biri kesilirse)
                                if (sh1Val.visibility <= 0.5 && sh2Val.visibility > 0.5) {
                                    let headX = ((p[2].x + p[5].x) / 2) * canvas.width;
                                    sh1.x = 2 * headX - sh2.x;
                                    sh1.y = sh2.y;
                                } else if (sh2Val.visibility <= 0.5 && sh1Val.visibility > 0.5) {
                                    let headX = ((p[2].x + p[5].x) / 2) * canvas.width;
                                    sh2.x = 2 * headX - sh1.x;
                                    sh2.y = sh1.y;
                                }

                                // Boyun Kökü ve Kafa Merkezi Hesaplama
                                let midSh = { 
                                    x: (sh1.x + sh2.x) / 2, 
                                    y: (sh1.y + sh2.y) / 2 
                                };
                                let headCenter = { 
                                    x: ((p[2].x + p[5].x) / 2) * canvas.width, 
                                    y: ((p[2].y + p[5].y) / 2) * canvas.height 
                                };
                                
                                // Boyun Üst Noktası (Çene / Kafatası Tabanı)
                                let neckTop = {
                                    x: headCenter.x + (midSh.x - headCenter.x) * 0.42,
                                    y: headCenter.y + (midSh.y - headCenter.y) * 0.42
                                };

                                // 1. Klavikula (Omuz Köprücük Kemiği)
                                ctx.beginPath();
                                ctx.moveTo(sh1.x, sh1.y);
                                ctx.lineTo(midSh.x, midSh.y);
                                ctx.lineTo(sh2.x, sh2.y);
                                ctx.strokeStyle = '#00f2fe';
                                ctx.lineWidth = 3;
                                ctx.stroke();

                                // 2. Boyun omur çizgisi (duruş durumuna göre renk alır)
                                ctx.beginPath();
                                ctx.moveTo(midSh.x, midSh.y);
                                ctx.lineTo(neckTop.x, neckTop.y);
                                ctx.strokeStyle = overlayColor;
                                ctx.lineWidth = 6;
                                ctx.stroke();

                                // Boyun-Baş Bağlantısı (Kafaya giden destek çizgisi)
                                ctx.beginPath();
                                ctx.moveTo(neckTop.x, neckTop.y);
                                ctx.lineTo(headCenter.x, headCenter.y);
                                ctx.strokeStyle = overlayColor;
                                ctx.lineWidth = 3;
                                ctx.stroke();

                                // 3. Baş Kafatası Çemberi
                                ctx.beginPath();
                                let headRadius = Math.sqrt(Math.pow(p[2].x - p[5].x, 2) + Math.pow(p[2].y - p[5].y, 2)) * canvas.width * 0.85;
                                ctx.arc(headCenter.x, headCenter.y, headRadius, 0, 2 * Math.PI);
                                ctx.strokeStyle = '#f59e0b';
                                ctx.lineWidth = 2.5;
                                ctx.stroke();

                                // 4. Göz ve Burun Bağlantıları (Yüz İskeleti)
                                let eyeLeft = { x: p[2].x * canvas.width, y: p[2].y * canvas.height };
                                let eyeRight = { x: p[5].x * canvas.width, y: p[5].y * canvas.height };
                                let nose = { x: p[0].x * canvas.width, y: p[0].y * canvas.height };

                                ctx.beginPath();
                                ctx.moveTo(eyeLeft.x, eyeLeft.y);
                                ctx.lineTo(headCenter.x, headCenter.y);
                                ctx.lineTo(eyeRight.x, eyeRight.y);
                                ctx.strokeStyle = '#f59e0b';
                                ctx.lineWidth = 2;
                                ctx.stroke();

                                ctx.beginPath();
                                ctx.moveTo(headCenter.x, headCenter.y);
                                ctx.lineTo(nose.x, nose.y);
                                ctx.strokeStyle = '#f59e0b';
                                ctx.lineWidth = 2;
                                ctx.stroke();

                                // Kulaklar görünüyorsa çene/jawline çizgisi çiz
                                if (p[7] && p[8] && p[7].visibility > 0.5 && p[8].visibility > 0.5) {
                                    let earLeft = { x: p[7].x * canvas.width, y: p[7].y * canvas.height };
                                    let earRight = { x: p[8].x * canvas.width, y: p[8].y * canvas.height };
                                    ctx.beginPath();
                                    ctx.moveTo(earLeft.x, earLeft.y);
                                    ctx.lineTo(neckTop.x, neckTop.y);
                                    ctx.lineTo(earRight.x, earRight.y);
                                    ctx.strokeStyle = '#f59e0b';
                                    ctx.lineWidth = 2.5;
                                    ctx.stroke();
                                }

                                // 5. Kollar (Bağımsız Çizim)
                                if (p[13] && p[13].visibility > 0.5) {
                                    let elLeft = { x: p[13].x * canvas.width, y: p[13].y * canvas.height };
                                    ctx.beginPath();
                                    ctx.moveTo(sh1.x, sh1.y);
                                    ctx.lineTo(elLeft.x, elLeft.y);
                                    if (p[15] && p[15].visibility > 0.5) {
                                        ctx.lineTo(p[15].x * canvas.width, p[15].y * canvas.height);
                                    }
                                    ctx.strokeStyle = '#00f2fe';
                                    ctx.lineWidth = 3;
                                    ctx.stroke();
                                }
                                if (p[14] && p[14].visibility > 0.5) {
                                    let elRight = { x: p[14].x * canvas.width, y: p[14].y * canvas.height };
                                    ctx.beginPath();
                                    ctx.moveTo(sh2.x, sh2.y);
                                    ctx.lineTo(elRight.x, elRight.y);
                                    if (p[16] && p[16].visibility > 0.5) {
                                        ctx.lineTo(p[16].x * canvas.width, p[16].y * canvas.height);
                                    }
                                    ctx.strokeStyle = '#00f2fe';
                                    ctx.lineWidth = 3;
                                    ctx.stroke();
                                }

                                // 6. Sırt/Gövde Omurgası, Kalça ve Bacaklar (Vücut İskelet Çizgileri)
                                if (p[23] && p[24] && p[23].visibility > 0.5 && p[24].visibility > 0.5) {
                                    let hip1 = { x: p[23].x * canvas.width, y: p[23].y * canvas.height };
                                    let hip2 = { x: p[24].x * canvas.width, y: p[24].y * canvas.height };
                                    let midHip = { x: (hip1.x + hip2.x) / 2, y: (hip1.y + hip2.y) / 2 };

                                    // Sırt / Gövde Omurgası
                                    ctx.beginPath();
                                    ctx.moveTo(midSh.x, midSh.y);
                                    ctx.lineTo(midHip.x, midHip.y);
                                    ctx.strokeStyle = overlayColor;
                                    ctx.lineWidth = 4;
                                    ctx.stroke();

                                    // Kalça Hattı
                                    ctx.beginPath();
                                    ctx.moveTo(hip1.x, hip1.y);
                                    ctx.lineTo(midHip.x, midHip.y);
                                    ctx.lineTo(hip2.x, hip2.y);
                                    ctx.strokeStyle = '#00f2fe';
                                    ctx.lineWidth = 3;
                                    ctx.stroke();

                                    // Sol Bacak
                                    if (p[25] && p[25].visibility > 0.5) {
                                        let kneeLeft = { x: p[25].x * canvas.width, y: p[25].y * canvas.height };
                                        ctx.beginPath();
                                        ctx.moveTo(hip1.x, hip1.y);
                                        ctx.lineTo(kneeLeft.x, kneeLeft.y);
                                        if (p[27] && p[27].visibility > 0.5) {
                                            let ankleLeft = { x: p[27].x * canvas.width, y: p[27].y * canvas.height };
                                            ctx.lineTo(ankleLeft.x, ankleLeft.y);
                                        }
                                        ctx.strokeStyle = '#00f2fe';
                                        ctx.lineWidth = 3;
                                        ctx.stroke();
                                    }

                                    // Sağ Bacak
                                    if (p[26] && p[26].visibility > 0.5) {
                                        let kneeRight = { x: p[26].x * canvas.width, y: p[26].y * canvas.height };
                                        ctx.beginPath();
                                        ctx.moveTo(hip2.x, hip2.y);
                                        ctx.lineTo(kneeRight.x, kneeRight.y);
                                        if (p[28] && p[28].visibility > 0.5) {
                                            let ankleRight = { x: p[28].x * canvas.width, y: p[28].y * canvas.height };
                                            ctx.lineTo(ankleRight.x, ankleRight.y);
                                        }
                                        ctx.strokeStyle = '#00f2fe';
                                        ctx.lineWidth = 3;
                                        ctx.stroke();
                                    }
                                }

                                let shTiltDeg = Math.round(Math.atan2(Math.abs(sh1.y - sh2.y), Math.abs(sh1.x - sh2.x)) * (180 / Math.PI));
                                const shoulderAlignModel = getShoulderAlignmentModel(p, side, isFrontal);
                                const shoulderLevelLimit = (postureType === 'sitting') ? limits.postureSittingShoulderLevel : limits.postureShoulderLevel;
                                ctx.fillStyle = (shoulderAlignModel.levelOffset <= shoulderLevelLimit) ? '#00e676' : '#ff3d00';
                                ctx.font = 'bold 13px sans-serif';
                                ctx.fillText(`Omuz Eğimi: ${shTiltDeg}°`, (sh1.x + sh2.x) / 2 - 40, (sh1.y + sh2.y) / 2 - 15);

                                // Duruş Skoru gösterimi (% olarak)
                                let currentScore = Math.round(rawVal * 100);
                                let targetScore = Math.round(((postureType === 'sitting') ? limits.postureSittingFrontalRatio : limits.postureFrontalRatio) * 100);
                                ctx.fillStyle = (rawVal >= ((postureType === 'sitting') ? limits.postureSittingFrontalRatio : limits.postureFrontalRatio)) ? '#00e676' : '#ff3d00';
                                ctx.fillText(`Diklik Skoru: ${currentScore}% (Hedef: >${targetScore}%)`, (sh1.x + sh2.x) / 2 - 65, (sh1.y + sh2.y) / 2 + 15);

                                const spineModel = getSpinePostureModel(p, side, isFrontal);
                                if (spineModel.hasRealHip) {
                                    const spineOffsetPct = Math.round(spineModel.frontalOffset * 100);
                                    const visualSpineLimit = (postureType === 'standing')
                                        ? limits.postureStandingFrontalSpineCurve
                                        : ((postureType === 'sitting') ? limits.postureSittingSpineFrontal : limits.postureSpineFrontal);
                                    const spineTarget = Math.round(visualSpineLimit * 100);
                                    ctx.fillStyle = spineModel.frontalOffset <= visualSpineLimit ? '#00e676' : '#ff3d00';
                                    ctx.fillText(`Omurga Hattı: ${spineOffsetPct}% (Hedef: <${spineTarget}%)`, (sh1.x + sh2.x) / 2 - 65, (sh1.y + sh2.y) / 2 + 34);
                                    ctx.fillStyle = spineModel.confidence > 0.58 ? '#94a3b8' : '#f59e0b';
                                    ctx.fillText(`Omurga Güven: ${Math.round(spineModel.confidence * 100)}%`, (sh1.x + sh2.x) / 2 - 65, (sh1.y + sh2.y) / 2 + 53);
                                }

                                const depthModel = getDepthPostureModel(p, side, isFrontal);
                                if (depthModel.hasShoulderDepth && postureType !== 'standing') {
                                    const depthLimit = (postureType === 'sitting') ? limits.postureSittingShoulderDepthFrontal : limits.postureShoulderDepthFrontal;
                                    ctx.fillStyle = depthModel.shoulderDepthDiff <= depthLimit ? '#00e676' : '#ff3d00';
                                    ctx.fillText(`3D Omuz Derinlik: ${depthModel.shoulderDepthDiff.toFixed(2)}`, (sh1.x + sh2.x) / 2 - 65, (sh1.y + sh2.y) / 2 + 72);
                                }
                                if (depthModel.hasSpineDepth) {
                                    const spineDepthLimit = (postureType === 'sitting') ? limits.postureSittingSpineDepthFrontal : limits.postureSpineDepthFrontal;
                                    ctx.fillStyle = depthModel.spineDepthOffset <= spineDepthLimit ? '#00e676' : '#ff3d00';
                                    ctx.fillText(`3D Omurga Derinlik: ${depthModel.spineDepthOffset.toFixed(2)}`, (sh1.x + sh2.x) / 2 - 65, (sh1.y + sh2.y) / 2 + 91);
                                }
                            }

                            if (p[2] && p[5] && checkVisibility([p[2], p[5]])) {
                                let eye1 = { x: p[2].x * canvas.width, y: p[2].y * canvas.height };
                                let eye2 = { x: p[5].x * canvas.width, y: p[5].y * canvas.height };
                                
                                ctx.beginPath();
                                ctx.moveTo(eye1.x, eye1.y);
                                ctx.lineTo(eye2.x, eye2.y);
                                ctx.strokeStyle = '#f59e0b';
                                ctx.lineWidth = 2;
                                ctx.stroke();

                                let headTiltDeg = Math.round(Math.atan2(Math.abs(eye1.y - eye2.y), Math.abs(eye1.x - eye2.x)) * (180 / Math.PI));
                                ctx.fillStyle = (headTiltDeg <= limits.postureHeadTilt) ? '#00e676' : '#ff3d00';
                                ctx.font = 'bold 13px sans-serif';
                                ctx.fillText(`Baş Eğimi: ${headTiltDeg}° (Hedef: <${limits.postureHeadTilt}°)`, (eye1.x + eye2.x) / 2 - 58, (eye1.y + eye2.y) / 2 - 15);

                                const depthModel = getDepthPostureModel(p, side, isFrontal);
                                if (depthModel.hasHeadDepth) {
                                    const frontalHeadLimit = (postureType === 'sitting') ? limits.postureSittingFrontalHeadForwardDepth : limits.postureFrontalHeadForwardDepth;
                                    const frontalCompressionLimit = (postureType === 'sitting') ? limits.postureSittingFrontalNeckCompressionRatio : limits.postureFrontalNeckCompressionRatio;
                                    const frontalDepthOnlyBad = depthModel.headForwardDepth > frontalHeadLimit;
                                    const frontalCompressionSevere = window.currentFrontalNeckCompression < frontalCompressionLimit;
                                    const frontalCompressionModerate = window.currentFrontalNeckCompression < 0.88;
                                    const frontalCombinedWarn = frontalDepthOnlyBad && frontalCompressionModerate;
                                    ctx.fillStyle = (frontalCompressionSevere || frontalCombinedWarn) ? '#f59e0b' : '#00e676';
                                    ctx.fillText(`Önden Boyun: ${depthModel.headForwardDepth.toFixed(2)} | Sıkışma: ${window.currentFrontalNeckCompression.toFixed(2)} (Limit: <${frontalCompressionLimit})`, (eye1.x + eye2.x) / 2 - 110, (eye1.y + eye2.y) / 2 + 4);
                                }
                            }
                        } else {
                            // Yan profil boyun, sırt ve omuz bağlantıları
                            let sh = { x: side.sh.x * canvas.width, y: side.sh.y * canvas.height };
                            let ear = { x: side.ear.x * canvas.width, y: side.ear.y * canvas.height };

                            // Kulağa giden çizgi (Boyun Omurgası)
                            ctx.beginPath();
                            ctx.moveTo(sh.x, sh.y);
                            ctx.lineTo(ear.x, ear.y);
                            ctx.strokeStyle = overlayColor;
                            ctx.lineWidth = 5;
                            ctx.stroke();

                            // Yan kafa kafatası çemberi
                            ctx.beginPath();
                            ctx.arc(ear.x, ear.y, 35, 0, 2 * Math.PI);
                            ctx.strokeStyle = '#f59e0b';
                            ctx.lineWidth = 2.5;
                            ctx.stroke();

                            // Dikey yerçekimi referans çizgisi
                            ctx.beginPath();
                            ctx.moveTo(sh.x, sh.y);
                            ctx.lineTo(sh.x, sh.y - 120);
                            ctx.strokeStyle = '#64748b';
                            ctx.setLineDash([5, 5]);
                            ctx.lineWidth = 2;
                            ctx.stroke();
                            ctx.setLineDash([]);

                            // Boyun açısı yayı (arc) çizimi
                            let earAngle = Math.atan2(ear.y - sh.y, ear.x - sh.x);
                            ctx.beginPath();
                            ctx.moveTo(sh.x, sh.y);
                            ctx.arc(sh.x, sh.y, 45, -Math.PI/2, earAngle, earAngle < -Math.PI/2);
                            ctx.strokeStyle = overlayColor;
                            ctx.lineWidth = 2;
                            ctx.stroke();
                            ctx.fillStyle = overlayColor + "22";
                            ctx.fill();

                            ctx.fillStyle = overlayColor;
                            ctx.font = 'bold 14px sans-serif';
                            ctx.fillText(`${(side.tr || 'Yan')} Boyun Açısı: ${rawVal}°`, sh.x + 15, sh.y - 45);

                            // Kollar (Yan Profil)
                            if (side.el && side.el.visibility > 0.5) {
                                let el = { x: side.el.x * canvas.width, y: side.el.y * canvas.height };
                                ctx.beginPath();
                                ctx.moveTo(sh.x, sh.y);
                                ctx.lineTo(el.x, el.y);
                                if (side.wr && side.wr.visibility > 0.5) {
                                    let wr = { x: side.wr.x * canvas.width, y: side.wr.y * canvas.height };
                                    ctx.lineTo(wr.x, wr.y);
                                }
                                ctx.strokeStyle = '#00f2fe';
                                ctx.lineWidth = 3;
                                ctx.stroke();
                            }

                            // Kalça görünüyorsa sırt gövde eğimi çizimi (Gövde Omurgası)
                            if (checkVisibility([side.hip])) {
                                let hip = { x: side.hip.x * canvas.width, y: side.hip.y * canvas.height };
                                
                                ctx.beginPath();
                                ctx.moveTo(hip.x, hip.y);
                                ctx.lineTo(sh.x, sh.y);
                                ctx.strokeStyle = '#00f2fe';
                                ctx.lineWidth = 4;
                                ctx.stroke();

                                let torsoAngle = Math.round(Math.atan2(Math.abs(sh.x - hip.x), Math.abs(hip.y - side.sh.y)) * (180 / Math.PI));
                                const spineModel = getSpinePostureModel(p, side, isFrontal);
                                const spineSideLimit = (postureType === 'sitting') ? limits.postureSittingSpineLateral : limits.postureSpineLateral;
                                ctx.fillStyle = Math.abs(spineModel.lateralAngle) <= spineSideLimit ? '#00e676' : '#ff3d00';
                                ctx.font = 'bold 13px sans-serif';
                                ctx.fillText(`${(side.tr || 'Yan')} Omurga Açısı: ${spineModel.lateralAngle}°`, hip.x + 15, hip.y - 30);
                                ctx.fillStyle = spineModel.confidence > 0.58 ? '#94a3b8' : '#f59e0b';
                                ctx.fillText(`Omurga Güven: ${Math.round(spineModel.confidence * 100)}%`, hip.x + 15, hip.y - 12);
                                ctx.fillStyle = '#00f2fe';
                                ctx.fillText(`Gövde Açısı: ${torsoAngle}°`, hip.x + 15, hip.y + 6);

                                const depthModel = getDepthPostureModel(p, side, isFrontal);
                                if (depthModel.hasHeadDepth) {
                                    const headDepthLimit = (postureType === 'sitting') ? limits.postureSittingHeadDepthForward : limits.postureHeadDepthForward;
                                    ctx.fillStyle = depthModel.headForwardDepth <= headDepthLimit ? '#00e676' : '#ff3d00';
                                    ctx.fillText(`3D Baş Derinlik: ${depthModel.headForwardDepth.toFixed(2)}`, hip.x + 15, hip.y + 24);
                                }
                                // Yan duruşta omuz derinlik farkı doğal olarak görülebilir; bu yüzden burada gösterilmiyor.

                                // Bacaklar (Yan Profil)
                                if (side.knee && side.knee.visibility > 0.5) {
                                    let knee = { x: side.knee.x * canvas.width, y: side.knee.y * canvas.height };
                                    ctx.beginPath();
                                    ctx.moveTo(hip.x, hip.y);
                                    ctx.lineTo(knee.x, knee.y);
                                    if (side.ankle && side.ankle.visibility > 0.5) {
                                        let ankle = { x: side.ankle.x * canvas.width, y: side.ankle.y * canvas.height };
                                        ctx.lineTo(ankle.x, ankle.y);
                                    }
                                    ctx.strokeStyle = '#00f2fe';
                                    ctx.lineWidth = 3;
                                    ctx.stroke();
                                }
                            }
                        }
                    }
                    else if (mode === 'plank') {
                        let sh = { x: side.sh.x * canvas.width, y: side.sh.y * canvas.height };
                        let hip = { x: side.hip.x * canvas.width, y: side.hip.y * canvas.height };
                        let ankle = { x: side.ankle.x * canvas.width, y: side.ankle.y * canvas.height };

                        ctx.beginPath();
                        ctx.moveTo(sh.x, sh.y);
                        ctx.lineTo(hip.x, hip.y);
                        ctx.lineTo(ankle.x, ankle.y);
                        ctx.strokeStyle = overlayColor;
                        ctx.lineWidth = 4;
                        ctx.stroke();

                        ctx.fillStyle = overlayColor;
                        ctx.font = 'bold 16px sans-serif';
                        ctx.fillText(`Plank Açısı: ${Math.round(finalVal)}°`, hip.x + 20, hip.y - 10);
                    }
                    else if (mode === 'bridge') {
                        let sh = { x: side.sh.x * canvas.width, y: side.sh.y * canvas.height };
                        let hip = { x: side.hip.x * canvas.width, y: side.hip.y * canvas.height };
                        let knee = { x: side.knee.x * canvas.width, y: side.knee.y * canvas.height };

                        ctx.beginPath();
                        ctx.moveTo(sh.x, sh.y);
                        ctx.lineTo(hip.x, hip.y);
                        ctx.lineTo(knee.x, knee.y);
                        ctx.strokeStyle = overlayColor;
                        ctx.lineWidth = 4;
                        ctx.stroke();

                        ctx.fillStyle = overlayColor;
                        ctx.font = 'bold 16px sans-serif';
                        ctx.fillText(`Köprü Açısı: ${Math.round(finalVal)}°`, hip.x + 20, hip.y - 20);
                    }
                    else if (mode === 'catcow') {
                        let sh = { x: side.sh.x * canvas.width, y: side.sh.y * canvas.height };
                        let el = { x: side.el.x * canvas.width, y: side.el.y * canvas.height };
                        let wr = { x: side.wr.x * canvas.width, y: side.wr.y * canvas.height };

                        ctx.beginPath();
                        ctx.moveTo(sh.x, sh.y);
                        ctx.lineTo(el.x, el.y);
                        ctx.lineTo(wr.x, wr.y);
                        ctx.strokeStyle = overlayColor;
                        ctx.lineWidth = 4;
                        ctx.stroke();

                        ctx.fillStyle = overlayColor;
                        ctx.font = 'bold 14px sans-serif';
                        ctx.fillText(`Dirsekler: ${Math.round(finalVal)}°`, el.x + 15, el.y);
                    }
                }

                // -------------------------------------------------------------
                // 3. EKRAN BİLDİRİMLERİ VE SAYAÇ (Ironclad Logic)
                // -------------------------------------------------------------
                if (!isCalibrating) {
                    const currentModeData = sessionData[mode];
                    if (!isVisible) {
                        aMain.innerText = "👀 VÜCUT TAM GÖRÜNMÜYOR"; aMain.className = "text-warn"; aSub.innerText = "Kameraya tam girin.";
                        currentModeData.lastState = 'neutral';
                        currentModeData.lastWarningText = '';
                        pendingPositiveSpeech = null;
                        lastSpokenText = '';
                        if (typeof resetSpeechAlertCycle === 'function') resetSpeechAlertCycle();
                    }
                    else if (isSetupError) {
                        // Pozisyon hatasında da mesaj değişirse yeni uyarıyı sesli oku.
                        pendingPositiveSpeech = null;
                        aMain.innerText = "⛔ POZİSYON HATASI"; aMain.className = "text-warn"; aSub.innerText = warningText;
                        const setupWarningChanged = currentModeData.lastWarningText !== warningText;
                        if (currentModeData.lastState !== 'setupError' || setupWarningChanged) {
                            announce(warningText, true);
                        }
                        currentModeData.lastWarningText = warningText;
                        currentModeData.lastState = 'setupError';
                    }
                    else {
                        if (isGood) {
                            const previousState = currentModeData.lastState;
                            currentModeData.good += delta; aMain.innerText = "✅ KUSURSUZ FORM"; aMain.className = "text-success"; aSub.innerText = "Mükemmel, pozisyonu bozmayın.";
                            currentModeData.lastState = 'good';
                            currentModeData.lastWarningText = '';
                            if (previousState !== 'good') {
                                resetSpeechAlertCycle();
                                if (previousState === 'bad' || previousState === 'setupError') {
                                    queuePositiveSpeech("Formunuz düzeldi.");
                                    lastSpokenText = "";
                                }
                            }
                        } else {
                            pendingPositiveSpeech = null;
                            currentModeData.bad += delta; aMain.innerText = "⚠️ FORM BOZUK"; aMain.className = "text-danger"; aSub.innerText = warningText;
                            const warningChanged = currentModeData.lastWarningText !== warningText;
                            if (currentModeData.lastState !== 'bad') {
                                currentModeData.breaks++;
                                registerWarningForMode(mode, warningText);
                                announce(warningText, true);
                            } else if (warningChanged) {
                                // Önceden burada ses bastırılıyordu. Artık hata tipi değişince sesli söylenir,
                                // ama yeni ihlal sayısı olarak sayılmaz; sadece hata istatistiğine eklenir.
                                registerWarningForMode(mode, warningText);
                                announce(warningText, true);
                            }
                            currentModeData.lastWarningText = warningText;
                            currentModeData.lastState = 'bad';
                        }
                        document.getElementById('timer-good').innerText = format(currentModeData.good);
                        document.getElementById('timer-bad').innerText = format(currentModeData.bad);
                        document.getElementById('count-breaks').innerText = currentModeData.breaks;
                    }
                }
            } else { aMain.innerText = "SİSTEM ANALİZE HAZIR"; aMain.className = ""; aSub.innerText = "Kameraya girin."; lastSpokenText = ""; if (typeof resetSpeechAlertCycle === 'function') resetSpeechAlertCycle(); }
            ctx.restore();
        }
        function exportPDF() {
            if (window.RetinaCoach && typeof window.RetinaCoach.exportPDF === 'function') {
                return window.RetinaCoach.exportPDF();
            }
            alert('Rapor modülü henüz yüklenmedi.');
        }

        const pose = new Pose({ locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${f}` });
        pose.setOptions({ modelComplexity: 1, smoothLandmarks: true, minDetectionConfidence: 0.6, minTrackingConfidence: 0.6 });
        pose.onResults(onResults);

        // Kendi Kamera Başlatma Mantığımız (Mediapiape Camera Sınıfı Yerine)
        let activeStream = null;
        let cameraActive = false;
        let currentFacingMode = 'user';

        async function startCamera() {
            if (activeStream) {
                activeStream.getTracks().forEach(track => track.stop());
            }

            const constraintsList = [
                { video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: currentFacingMode } },
                { video: { facingMode: currentFacingMode } },
                { video: true }
            ];

            let lastError = null;
            for (const constraints of constraintsList) {
                try {
                    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                        throw new Error("Tarayıcı Kamera API desteği sunmuyor ya da güvenli (HTTPS) bağlantı kurulmamış.");
                    }
                    activeStream = await navigator.mediaDevices.getUserMedia(constraints);
                    video.srcObject = activeStream;
                    await new Promise((resolve) => {
                        video.onloadedmetadata = () => {
                            resolve();
                        };
                    });
                    await video.play();
                    cameraActive = true;
                    requestAnimationFrame(processVideo);
                    closeCameraError();
                    return;
                } catch (err) {
                    lastError = err;
                    console.warn("Kamera yapılandırma denemesi başarısız:", constraints, err);
                }
            }

            console.error("Kamera başlatılamadı:", lastError);
            showCameraError(lastError);
        }

        async function processVideo() {
            if (!cameraActive || video.paused || video.ended) return;
            try {
                await pose.send({ image: video });
            } catch (e) {
                console.error("Poz işleme hatası:", e);
            }
            requestAnimationFrame(processVideo);
        }

        function showCameraError(err) {
            const modal = document.getElementById('camera-error-modal');
            const detailSpan = document.getElementById('camera-error-detail');
            if (modal && detailSpan) {
                detailSpan.innerText = err ? `${err.name}: ${err.message}` : "Bilinmeyen Hata";
                modal.style.display = 'flex';
            } else {
                alert("Kamera başlatılamadı: " + (err ? err.message : ""));
            }
        }

        function closeCameraError() {
            const modal = document.getElementById('camera-error-modal');
            if (modal) modal.style.display = 'none';
        }

        function retryCamera() {
            closeCameraError();
            startCamera();
        }

        async function toggleCameraFacing() {
            currentFacingMode = (currentFacingMode === 'user') ? 'environment' : 'user';
            const toggleBtn = document.getElementById('camera-toggle-btn');
            if (toggleBtn) {
                toggleBtn.innerText = currentFacingMode === 'user' ? '🔄 ÖN KAMERA' : '🔄 ARKA KAMERA';
            }
            await startCamera();
        }

        // Kamerayı otomatik başlat
        startCamera();
    

/* ===============================
   RETINA AI Smart Coach Layer
   Existing pose engine remains intact; this layer adds storage, scoring, reports, dashboard data and PWA hooks.
   =============================== */
(function () {
    const STORE = {
        settings: 'retina_ai_settings',
        limits: 'retina_ai_limits',
        sessions: 'retina_ai_sessions',
        snapshot: 'retina_ai_live_snapshot',
        calibration: 'retina_ai_calibration'
    };

    const DEFAULT_SETTINGS = {
        sensitivity: 'normal',
        voiceStyle: 'screen',
        targetMinutes: 10,
        autoSave: true,
        headScale: 100,
        spineScale: 100,
        shoulderScale: 100,
        reportNote: ''
    };

    const EXERCISE_PLANS = {
        posture: {
            title: 'Postür Analizi',
            target: 'Baş, boyun, omuz ve omurga hattı',
            tips: ['Kamerada baş ve omuzlar net görünsün.', 'Ayakta modda bel ve aşağısı görünüyorsa sistem ayakta varsayar.', 'Baş-omuz hattını aynı dikey eksende tut.']
        },
        catcow: {
            title: 'Kedi-İnek',
            target: 'Omurga mobilitesi ve omuz stabilitesi',
            tips: ['Dirsekleri kilitle.', 'Sırtı yere paralel tut.', 'Hareketi kontrollü yap.']
        },
        birddog: {
            title: 'Kuş-Köpek',
            target: 'Core dengesi ve kalça kontrolü',
            tips: ['Bacağı kalça hizasına uzat.', 'Bel çukurunu abartma.', 'Omuzları sabit tut.']
        },
        doorway: {
            title: 'Eşik Esneme',
            target: 'Göğüs ve omuz açıklığı',
            tips: ['Önden kamera kullan.', 'Dirseği omuz hizasına getir.', 'Boynu sıkıştırma.']
        },
        plank: {
            title: 'Plank',
            target: 'Core dayanıklılığı',
            tips: ['Omuz-kalça-topuk hattını düz tut.', 'Kalçayı düşürme veya çok kaldırma.', 'Boynu omurga ile aynı hatta tut.']
        },
        bridge: {
            title: 'Köprü',
            target: 'Kalça ve posterior chain aktivasyonu',
            tips: ['Kalçayı yeterince yukarı it.', 'Dizleri kalça hattında tut.', 'Bel yerine kalçayı çalıştır.']
        }
    };

    const state = {
        settings: { ...DEFAULT_SETTINGS },
        baseLimits: null,
        lastSavedAt: 0,
        activeSessionId: `session-${Date.now()}`,
        currentScore: 100,
        confidence: 0,
        reps: {},
        lastRepSignal: {},
        lastKnownWarning: '',
        lastKnownState: 'neutral',
        startedAt: Date.now(),
        saveTimer: null
    };

    function readJSON(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (e) {
            console.warn('Storage okunamadı:', key, e);
            return fallback;
        }
    }

    function writeJSON(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); }
        catch (e) { console.warn('Storage yazılamadı:', key, e); }
    }

    function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

    function toast(message) {
        let stack = document.querySelector('.toast-stack');
        if (!stack) {
            stack = document.createElement('div');
            stack.className = 'toast-stack';
            document.body.appendChild(stack);
        }
        const item = document.createElement('div');
        item.className = 'toast-item';
        item.textContent = message;
        stack.appendChild(item);
        setTimeout(() => item.remove(), 3600);
    }

    function getModeData(m = mode) {
        return sessionData[m] || { good: 0, bad: 0, breaks: 0, errors: {}, lastState: 'neutral' };
    }

    function getModeScore(m = mode) {
        const data = getModeData(m);
        const total = data.good + data.bad;
        if (!total) return data.lastState === 'bad' ? 55 : 100;
        const clean = Math.round((data.good / total) * 100);
        const breakPenalty = Math.min(22, data.breaks * 2);
        return Math.max(0, Math.min(100, clean - breakPenalty));
    }

    function getTotalStats() {
        const modes = Object.keys(sessionData || {});
        const totals = modes.reduce((acc, key) => {
            const d = sessionData[key];
            acc.good += d.good || 0;
            acc.bad += d.bad || 0;
            acc.breaks += d.breaks || 0;
            Object.entries(d.errors || {}).forEach(([err, count]) => {
                acc.errors[err] = (acc.errors[err] || 0) + count;
            });
            return acc;
        }, { good: 0, bad: 0, breaks: 0, errors: {} });
        totals.total = totals.good + totals.bad;
        totals.score = totals.total ? Math.max(0, Math.round((totals.good / totals.total) * 100) - Math.min(20, totals.breaks)) : 100;
        totals.topError = Object.entries(totals.errors).sort((a, b) => b[1] - a[1])[0] || ['', 0];
        return totals;
    }

    function formatMs(ms) {
        const s = Math.floor((ms || 0) / 1000);
        return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    }

    function humanDate(ts) {
        return new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ts));
    }

    function getCoachAdviceFromError(errorText) {
        const t = (errorText || '').toLowerCase();
        if (!t) return 'Formu koru. Baş, omuz ve omurga hattını sakin şekilde takip ediyorum.';
        if (t.includes('baş') || t.includes('boyun') || t.includes('çene')) return 'Baş-boyun hattı için çeneyi hafif geriye al, enseyi uzat ve omuzları gevşet.';
        if (t.includes('omuz')) return 'Omuzları kulaklardan uzaklaştır, göğsü hafif aç ve sağ-sol omuz seviyesini eşitle.';
        if (t.includes('omurga') || t.includes('kambur') || t.includes('sırt')) return 'Omurgayı uzat, göğsü hafif aç ve bel-kalça hattını merkeze taşı.';
        if (t.includes('kalça')) return 'Kalçayı hedef hatta getir. Karın kaslarını hafif aktif tutarak pelvis kontrolünü koru.';
        if (t.includes('diz')) return 'Diz ve ayak hattını eşitle. Dizleri içe veya dışa kaçırmadan pozisyonu sabitle.';
        if (t.includes('kamera') || t.includes('görün')) return 'Kameradan biraz uzaklaş ve analiz edilen eklemlerin tamamını kadraja al.';
        return errorText;
    }

    function smartenSpeech(text) {
        // Sesli uyarı artık ekranda görünen alt uyarı metnini temel alır.
        // Önceki yapıda 'natural' modu metni kategori tavsiyesine çeviriyordu;
        // bu yüzden omuz/omurga uyarılarında bile sürekli baş-boyun tavsiyesi okunabiliyordu.
        const rawText = String(text || '').trim();
        const style = state.settings.voiceStyle || 'screen';
        if (!rawText) return rawText;
        if (style === 'short') return rawText.replace(/^Hata:\s*/i, '').split('.')[0] + '.';
        return rawText;
    }

    function applySettingsToLimits() {
        if (!state.baseLimits) state.baseLimits = clone(limits);
        Object.assign(limits, clone(state.baseLimits));

        const generalScale = state.settings.sensitivity === 'low' ? 1.18 : (state.settings.sensitivity === 'high' ? 0.86 : 1);
        const headScale = (Number(state.settings.headScale) || 100) / 100;
        const spineScale = (Number(state.settings.spineScale) || 100) / 100;
        const shoulderScale = (Number(state.settings.shoulderScale) || 100) / 100;

        const headKeys = [
            'postureHeadTilt', 'postureLateralHeadForwardRight', 'postureLateralHeadForwardLeft',
            'postureHeadDepthForward', 'postureSittingHeadDepthForward', 'postureFrontalHeadForwardDepth',
            'postureSittingFrontalHeadForwardDepth', 'postureStandingEarShoulderOffset'
        ];
        const spineKeys = [
            'postureSpineFrontal', 'postureSittingSpineFrontal', 'postureSpineLateral', 'postureSittingSpineLateral',
            'postureStandingKyphosisScore', 'postureStandingSpineForwardBend', 'postureStandingSpineBackwardBend',
            'postureStandingFrontalSpineCurve', 'postureSpineDepthFrontal', 'postureSittingSpineDepthFrontal'
        ];
        const shoulderKeys = [
            'postureShoulderLevel', 'postureSittingShoulderLevel', 'postureShoulderCenter', 'postureSittingShoulderCenter',
            'postureShoulderStackLateral', 'postureSittingShoulderStackLateral', 'postureShoulderDepthFrontal',
            'postureSittingShoulderDepthFrontal', 'postureStandingShoulderHipOffset'
        ];

        headKeys.forEach(k => { if (typeof limits[k] === 'number') limits[k] *= generalScale * headScale; });
        spineKeys.forEach(k => { if (typeof limits[k] === 'number') limits[k] *= generalScale * spineScale; });
        shoulderKeys.forEach(k => { if (typeof limits[k] === 'number') limits[k] *= generalScale * shoulderScale; });

        const savedLimits = readJSON(STORE.limits, null);
        if (savedLimits && typeof savedLimits === 'object') Object.assign(limits, savedLimits);
    }

    function loadCoachSettings() {
        state.settings = { ...DEFAULT_SETTINGS, ...readJSON(STORE.settings, {}) };
        const savedLimits = readJSON(STORE.limits, null);
        if (savedLimits && typeof savedLimits === 'object') Object.assign(limits, savedLimits);
        applySettingsToLimits();
    }

    function bindSettingsForm() {
        const map = {
            sensitivity: document.getElementById('setting-sensitivity'),
            voiceStyle: document.getElementById('setting-voice-style'),
            targetMinutes: document.getElementById('setting-target-minutes'),
            autoSave: document.getElementById('setting-autosave'),
            headScale: document.getElementById('setting-head'),
            spineScale: document.getElementById('setting-spine'),
            shoulderScale: document.getElementById('setting-shoulder'),
            reportNote: document.getElementById('setting-report-note')
        };
        if (!map.sensitivity) return;
        map.sensitivity.value = state.settings.sensitivity;
        map.voiceStyle.value = state.settings.voiceStyle;
        map.targetMinutes.value = state.settings.targetMinutes;
        map.autoSave.value = state.settings.autoSave ? 'on' : 'off';
        map.headScale.value = state.settings.headScale;
        map.spineScale.value = state.settings.spineScale;
        map.shoulderScale.value = state.settings.shoulderScale;
        map.reportNote.value = state.settings.reportNote || '';
    }

    function openCoachSettings() {
        bindSettingsForm();
        const modal = document.getElementById('coach-settings-modal');
        if (modal) { modal.style.display = 'flex'; isModalOpen = true; }
    }

    function closeCoachSettings() {
        const modal = document.getElementById('coach-settings-modal');
        if (modal) { modal.style.display = 'none'; isModalOpen = false; }
    }

    function saveCoachSettings() {
        const get = id => document.getElementById(id);
        state.settings = {
            sensitivity: get('setting-sensitivity')?.value || 'normal',
            voiceStyle: get('setting-voice-style')?.value || 'screen',
            targetMinutes: Math.max(1, Number(get('setting-target-minutes')?.value || 10)),
            autoSave: (get('setting-autosave')?.value || 'on') === 'on',
            headScale: Number(get('setting-head')?.value || 100),
            spineScale: Number(get('setting-spine')?.value || 100),
            shoulderScale: Number(get('setting-shoulder')?.value || 100),
            reportNote: get('setting-report-note')?.value || ''
        };
        writeJSON(STORE.settings, state.settings);
        applySettingsToLimits();
        closeCoachSettings();
        toast('Smart Coach ayarları kaydedildi.');
    }

    function resetCoachSettings() {
        state.settings = { ...DEFAULT_SETTINGS };
        localStorage.removeItem(STORE.settings);
        localStorage.removeItem(STORE.limits);
        if (state.baseLimits) Object.assign(limits, clone(state.baseLimits));
        bindSettingsForm();
        toast('Ayarlar varsayılana döndü.');
    }

    function saveCalibration() {
        writeJSON(STORE.limits, limits);
        writeJSON(STORE.calibration, { savedAt: Date.now(), postureType, limits });
    }

    function clearCalibration() {
        localStorage.removeItem(STORE.limits);
        localStorage.removeItem(STORE.calibration);
        if (state.baseLimits) Object.assign(limits, clone(state.baseLimits));
        applySettingsToLimits();
        toast('Kalibrasyon kaydı temizlendi.');
    }

    function buildSessionSnapshot(manual = false) {
        const totals = getTotalStats();
        const modes = Object.fromEntries(Object.entries(sessionData).map(([key, value]) => [key, {
            good: value.good || 0,
            bad: value.bad || 0,
            breaks: value.breaks || 0,
            lastState: value.lastState || 'neutral',
            score: getModeScore(key),
            errors: value.errors || {}
        }]));
        return {
            id: state.activeSessionId,
            savedAt: Date.now(),
            startedAt: state.startedAt,
            manual,
            activeMode: mode,
            postureType,
            settings: state.settings,
            totalGood: totals.good,
            totalBad: totals.bad,
            totalTime: totals.total,
            breaks: totals.breaks,
            score: totals.score,
            topError: totals.topError[0],
            topErrorCount: totals.topError[1],
            modes,
            reps: state.reps,
            note: state.settings.reportNote || ''
        };
    }

    function saveCurrentSession(manual = false) {
        const snap = buildSessionSnapshot(manual);
        writeJSON(STORE.snapshot, snap);
        if (!manual && (!snap.totalTime || snap.totalTime < 1000)) return snap;
        const sessions = readJSON(STORE.sessions, []);
        const existingIndex = sessions.findIndex(s => s.id === snap.id);
        if (existingIndex >= 0) sessions[existingIndex] = snap;
        else sessions.unshift(snap);
        writeJSON(STORE.sessions, sessions.slice(0, 100));
        state.lastSavedAt = Date.now();
        if (manual) toast('Seans geçmişe kaydedildi.');
        return snap;
    }

    function resetCurrentSession() {
        Object.values(sessionData).forEach(d => {
            d.good = 0; d.bad = 0; d.breaks = 0; d.lastState = 'neutral'; d.lastWarningText = ''; d.errors = {};
        });
        state.activeSessionId = `session-${Date.now()}`;
        state.startedAt = Date.now();
        state.reps = {};
        updateCoachUI();
        toast('Yeni seans başlatıldı.');
    }

    function updateScoreUI(score) {
        const scoreEl = document.getElementById('form-score');
        const barEl = document.getElementById('form-score-bar');
        if (scoreEl) {
            scoreEl.textContent = String(score);
            scoreEl.className = 'stat-value ' + (score >= 80 ? 'text-success' : score >= 55 ? 'text-warn' : 'text-danger');
        }
        if (barEl) barEl.style.width = `${score}%`;
    }

    function updateConfidenceUI() {
        const data = getModeData();
        let confidence = 0.72;
        if (data.lastState === 'good') confidence = 0.94;
        if (data.lastState === 'bad') confidence = 0.86;
        if (data.lastState === 'setupError') confidence = 0.68;
        if (data.lastState === 'neutral') confidence = 0.52;
        const badge = document.getElementById('confidence-score');
        if (badge) badge.textContent = `${Math.round(confidence * 100)}%`;
        state.confidence = confidence;
    }

    function updateCoachGuide() {
        const guide = document.getElementById('coach-guide-text');
        const quality = document.getElementById('quality-badge');
        if (!guide) return;
        const data = getModeData();
        const plan = EXERCISE_PLANS[mode];
        const alertText = (aSub && aSub.innerText) ? aSub.innerText : '';
        let text = plan ? `${plan.title}: ${plan.tips[0]}` : 'Pozisyonu koruyun.';
        if (data.lastState === 'good') text = `İyi gidiyor. ${plan ? plan.target : 'form'} hattını koru.`;
        if (data.lastState === 'bad') text = getCoachAdviceFromError(alertText || state.lastKnownWarning);
        if (data.lastState === 'setupError' || alertText.includes('Kameraya') || alertText.includes('görün')) text = getCoachAdviceFromError(alertText);
        guide.textContent = text;
        if (quality) {
            const camText = alertText.includes('görün') ? 'MESAFE: GERİ ÇEKİL' : (state.confidence < .7 ? 'GÜVEN: ORTA' : 'IŞIK / MESAFE: İYİ');
            quality.textContent = camText;
        }
    }

    function updateRepCounter() {
        const repEl = document.getElementById('rep-counter');
        if (!repEl) return;
        if (!state.reps[mode]) state.reps[mode] = { reps: 0, sets: 0, holdMs: 0, lastGoodAt: 0 };
        const r = state.reps[mode];
        const data = getModeData();
        const isGoodNow = data.lastState === 'good';
        const now = Date.now();

        if (mode === 'posture') {
            const targetMs = (state.settings.targetMinutes || 10) * 60 * 1000;
            const current = Math.min(100, Math.round(((data.good || 0) / targetMs) * 100));
            repEl.textContent = `${current}% hedef`;
            return;
        }

        if (isGoodNow) {
            if (!r.lastGoodAt) r.lastGoodAt = now;
            r.holdMs += 500;
            const targetHold = (mode === 'plank') ? 10000 : 1800;
            if (r.holdMs >= targetHold && !state.lastRepSignal[mode]) {
                r.reps += 1;
                if (r.reps > 0 && r.reps % 10 === 0) r.sets += 1;
                state.lastRepSignal[mode] = true;
            }
        } else {
            r.holdMs = 0;
            r.lastGoodAt = 0;
            state.lastRepSignal[mode] = false;
        }
        repEl.textContent = `${r.reps} / ${r.sets}`;
    }

    function updateCoachUI() {
        const score = getModeScore();
        state.currentScore = score;
        updateScoreUI(score);
        updateConfidenceUI();
        updateRepCounter();
        updateCoachGuide();
        const current = buildSessionSnapshot(false);
        writeJSON(STORE.snapshot, current);
    }

    function createAdviceBlocks(snapshot) {
        const topError = snapshot.topError || '';
        const t = topError.toLowerCase();
        if (t.includes('baş') || t.includes('boyun')) return ['Chin tuck: 2 set x 10 tekrar', 'Göğüs açma esnetmesi: 2 x 30 sn', 'Ekran yüksekliğini göz hizasına al.'];
        if (t.includes('omuz')) return ['Wall angel: 2 set x 8 tekrar', 'Scapular retraction: 2 set x 12 tekrar', 'Omuzları kulaktan uzaklaştırma pratiği.'];
        if (t.includes('omurga') || t.includes('kambur') || t.includes('sırt')) return ['Thoracic extension: 2 x 45 sn', 'Cat-cow: 2 set x 10 tekrar', 'Göğüs açma + sırt aktivasyonu.'];
        if (t.includes('kalça') || t.includes('bel')) return ['Glute bridge: 3 set x 12 tekrar', 'Dead bug: 2 set x 8 tekrar', 'Hip flexor stretch: 2 x 30 sn.'];
        return ['Günlük 10 dk postür analizi yap.', 'Haftada 3 gün plank + bridge ekle.', 'Aynı kamera mesafesiyle ölçüm yap.'];
    }

    function exportPDF() {
        const snap = saveCurrentSession(false);
        const { jsPDF } = window.jspdf || {};
        if (!jsPDF) {
            alert('PDF kütüphanesi yüklenemedi. İnternet bağlantısını kontrol edin.');
            return;
        }

        const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
        const pageW = 210;
        const pageH = 297;

        // Türkçe karakterler bozulmasın diye raporu yüksek çözünürlüklü canvas üzerinde çiziyoruz.
        // Aynı zamanda düzeni tam sayfa A4 olacak şekilde piksel tabanlı kuruyoruz.
        const canvasPDF = document.createElement('canvas');
        canvasPDF.width = 1240;
        canvasPDF.height = 1754;
        const c = canvasPDF.getContext('2d');

        const W = canvasPDF.width;
        const H = canvasPDF.height;
        const margin = 72;
        const contentW = W - margin * 2;
        let y = 0;

        c.fillStyle = '#f8fafc';
        c.fillRect(0, 0, W, H);

        function setFont(size, weight = '500') {
            c.font = `${weight} ${size}px Inter, Arial, Helvetica, sans-serif`;
            c.textBaseline = 'top';
        }

        function wrapText(text, maxWidth, size = 28, weight = '500') {
            const value = String(text || '');
            setFont(size, weight);
            const words = value.split(/\s+/);
            const lines = [];
            let current = '';
            words.forEach(word => {
                const test = current ? `${current} ${word}` : word;
                if (!current || c.measureText(test).width <= maxWidth) current = test;
                else { lines.push(current); current = word; }
            });
            if (current) lines.push(current);
            return lines;
        }

        function drawText(text, x, yy, size = 28, color = '#283144', weight = '500', maxWidth = contentW, lineHeight = 1.35) {
            const lines = wrapText(text, maxWidth, size, weight);
            setFont(size, weight);
            c.fillStyle = color;
            const lineH = size * lineHeight;
            lines.forEach((lineText, index) => c.fillText(lineText, x, yy + index * lineH));
            return yy + Math.max(1, lines.length) * lineH;
        }

        function line(text, size = 28, color = '#283144', weight = '500', gap = 18, maxWidth = contentW, lineHeight = 1.35) {
            y = drawText(text, margin, y, size, color, weight, maxWidth, lineHeight);
            y += gap;
        }

        function roundRect(x, yy, w, h, r) {
            c.beginPath();
            c.moveTo(x + r, yy);
            c.lineTo(x + w - r, yy);
            c.quadraticCurveTo(x + w, yy, x + w, yy + r);
            c.lineTo(x + w, yy + h - r);
            c.quadraticCurveTo(x + w, yy + h, x + w - r, yy + h);
            c.lineTo(x + r, yy + h);
            c.quadraticCurveTo(x, yy + h, x, yy + h - r);
            c.lineTo(x, yy + r);
            c.quadraticCurveTo(x, yy, x + r, yy);
            c.closePath();
        }

        function card(x, yy, w, h, label, value, accent) {
            c.fillStyle = '#ffffff';
            roundRect(x, yy, w, h, 24);
            c.fill();
            c.strokeStyle = '#dbe3ef';
            c.lineWidth = 2;
            c.stroke();
            drawText(label, x + 26, yy + 18, 26, '#64748b', '800', w - 52, 1.15);
            drawText(value, x + 26, yy + 64, 44, accent || '#0f172a', '900', w - 52, 1.1);
        }

        // Header
        c.fillStyle = '#020617';
        c.fillRect(0, 0, W, 260);
        drawText('RETINA AI', margin, 50, 78, '#00f2fe', '900', contentW, 1.02);
        drawText('Smart Coach Postür ve Egzersiz Raporu', margin, 142, 34, '#f8fafc', '800', contentW, 1.15);
        drawText(humanDate(snap.savedAt), margin, 192, 24, '#cbd5e1', '500', contentW, 1.15);

        // Summary cards
        y = 310;
        const gap = 26;
        const cardW = Math.floor((contentW - gap * 2) / 3);
        const cardH = 150;
        const scoreColor = snap.score >= 80 ? '#008c5a' : snap.score >= 55 ? '#b46900' : '#d23728';
        card(margin, y, cardW, cardH, 'GENEL SKOR', `${snap.score}/100`, scoreColor);
        card(margin + cardW + gap, y, cardW, cardH, 'DOĞRU FORM', formatMs(snap.totalGood), '#008c5a');
        card(margin + (cardW + gap) * 2, y, cardW, cardH, 'HATALI FORM', formatMs(snap.totalBad), '#d23728');
        y += cardH + 54;

        line(`Toplam süre: ${formatMs(snap.totalTime)} | İhlal: ${snap.breaks}`, 32, '#0f172a', '800', 24);
        line(`Aktif mod: ${EXERCISE_PLANS[snap.activeMode]?.title || snap.activeMode} | Postür tipi: ${snap.postureType === 'standing' ? 'Ayakta' : 'Oturarak'}`, 30, '#283144', '500', 18, contentW, 1.28);
        line(`En sık hata: ${snap.topError || 'Hata kaydı yok'}${snap.topErrorCount ? ' (' + snap.topErrorCount + ' kez)' : ''}`, 30, '#283144', '500', 24, contentW, 1.28);
        if (snap.note) line(`Not: ${snap.note}`, 26, '#334155', '500', 20, contentW, 1.28);

        y += 8;
        line('Mod Bazlı Sonuçlar', 40, '#0f172a', '900', 14);
        Object.entries(snap.modes).forEach(([key, d]) => {
            const label = EXERCISE_PLANS[key]?.title || key;
            line(`• ${label}: skor ${d.score}/100, doğru ${formatMs(d.good)}, hatalı ${formatMs(d.bad)}, ihlal ${d.breaks}`, 24, '#334155', '500', 10, contentW, 1.25);
        });

        y += 10;
        line('Kişisel Öneriler', 40, '#0f172a', '900', 14);
        createAdviceBlocks(snap).forEach((a, i) => line(`${i + 1}. ${a}`, 24, '#334155', '500', 10, contentW, 1.28));

        // Footer
        const footerY = H - 96;
        c.strokeStyle = '#dbe3ef';
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(margin, footerY);
        c.lineTo(W - margin, footerY);
        c.stroke();
        drawText('Not: Bu uygulama tıbbi tanı koymaz; yalnızca kamera temelli form geri bildirimi sağlar.', margin, footerY + 18, 18, '#64748b', '500', contentW, 1.28);

        const img = canvasPDF.toDataURL('image/png');
        pdf.addImage(img, 'PNG', 0, 0, pageW, pageH, undefined, 'FAST');
        pdf.save(`retina-ai-rapor-${new Date().toISOString().slice(0,10)}.pdf`);
        toast('PDF rapor düzeni düzeltildi. Rapor artık tam sayfa ve düzgün görünüyor.');
    }

    function hookOriginalFunctions() {
        if (typeof announce === 'function') {
            const originalAnnounce = announce;
            announce = function (txt, force = false) {
                const sourceText = String(txt || '').trim();
                const visibleText = (aSub && aSub.innerText && String(aSub.innerText).trim()) ? String(aSub.innerText).trim() : '';

                // Sistem mesajlarını (geri sayım, kalibrasyon, karşılama, form düzeldi) ekrandaki alt metinle ezme.
                // Normal uyarılarda ise ses kaynağı ekranda görünen gerçek alt uyarı olsun.
                const finalText = isSystemSpeechMessage(sourceText) ? sourceText : (visibleText || sourceText);
                state.lastKnownWarning = finalText;
                return originalAnnounce(smartenSpeech(finalText), force);
            };
        }
        if (typeof finishCalibration === 'function') {
            const originalFinish = finishCalibration;
            finishCalibration = function () {
                const res = originalFinish.apply(this, arguments);
                saveCalibration();
                toast('Kalibrasyon kaydedildi.');
                return res;
            };
        }
        if (typeof switchMode === 'function') {
            const originalSwitch = switchMode;
            switchMode = function (m) {
                const res = originalSwitch.apply(this, arguments);
                updateCoachUI();
                return res;
            };
        }
        if (typeof setPostureType === 'function') {
            const originalSetPostureType = setPostureType;
            setPostureType = function () {
                const res = originalSetPostureType.apply(this, arguments);
                writeJSON(STORE.settings, { ...state.settings, lastPostureType: postureType });
                updateCoachUI();
                return res;
            };
        }
    }

    function registerPWA() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('sw.js').catch(() => {});
        }
    }

    function init() {
        state.baseLimits = clone(limits);
        loadCoachSettings();
        hookOriginalFunctions();
        bindSettingsForm();
        registerPWA();
        updateMobileModeMenu('posture');
        document.addEventListener('click', (event) => {
            const bar = document.querySelector('.mobile-mode-bar');
            if (bar && !bar.contains(event.target)) closeMobileModeMenu();
        });
        updateCoachUI();
        state.saveTimer = setInterval(() => {
            updateCoachUI();
            if (state.settings.autoSave && Date.now() - state.lastSavedAt > 12000) saveCurrentSession(false);
        }, 500);
        window.addEventListener('pagehide', () => saveCurrentSession(false));
    }

    window.RetinaCoach = {
        STORE,
        EXERCISE_PLANS,
        state,
        openCoachSettings,
        closeCoachSettings,
        saveCoachSettings,
        resetCoachSettings,
        clearCalibration,
        saveCalibration,
        saveCurrentSession,
        resetCurrentSession,
        exportPDF,
        readJSON,
        writeJSON,
        formatMs,
        humanDate,
        getTotalStats,
        createAdviceBlocks,
        toast
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();

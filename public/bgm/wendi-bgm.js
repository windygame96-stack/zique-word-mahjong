(() => {
  'use strict';
  const script = document.currentScript;
  if (!script || document.getElementById('wendi-bgm-toggle')) return;
  const pref = 'wendi-bgm:' + (script.dataset.game || location.pathname);
  const track = new Audio();
  track.preload = 'none';
  track.loop = true;
  track.volume = Number(script.dataset.volume || .24);
  track.src = new URL('loop.wav', script.src).href;
  let enabled = true, activated = false, attempt = 0;
  try { enabled = localStorage.getItem(pref) !== 'off'; } catch {}
  const button = document.createElement('button');
  button.id = 'wendi-bgm-toggle';
  button.type = 'button';
  button.style.cssText = 'position:fixed;left:max(12px,env(safe-area-inset-left));bottom:max(12px,env(safe-area-inset-bottom));z-index:1400;width:40px;height:40px;padding:0;display:grid;place-items:center;border:1px solid #ffffff70;border-radius:50%;color:#fff;background:#15151bea;box-shadow:0 2px 10px #0004;cursor:pointer;font:700 18px/1 system-ui,sans-serif';
  function refresh() {
    const playing = enabled && !track.paused;
    const english = document.documentElement.lang.toLowerCase().startsWith('en');
    const label = english ? (playing ? 'Mute background music' : 'Play background music') : (playing ? '关闭背景音乐' : '播放背景音乐');
    button.textContent = playing ? '♫' : '♪';
    button.style.opacity = playing ? '1' : '.72';
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(playing));
    button.title = label;
  }
  function play() {
    if (!enabled || !activated || document.hidden) return;
    const id = ++attempt;
    track.play().then(() => {
      if (!enabled || document.hidden) track.pause();
      refresh();
    }).catch(() => {
      if (id === attempt) refresh();
    });
  }
  function stop() { attempt++; track.pause(); refresh(); }
  function save() { try { localStorage.setItem(pref, enabled ? 'on' : 'off'); } catch {} }
  button.addEventListener('click', () => {
    if (enabled && !track.paused) { enabled = false; stop(); }
    else { enabled = true; activated = true; play(); }
    save();
    refresh();
  });
  document.addEventListener('click', (event) => {
    if (!event.isTrusted || activated || !enabled) return;
    const target = event.target instanceof Element ? event.target.closest('button,[role="button"],a,canvas') : null;
    if (!target || target === button || target.matches(':disabled,[aria-disabled="true"]')) return;
    const label = (target.textContent || '').replace(/\s+/g, ' ').trim();
    const match = /开始(?:新)?游戏|继续(?:上次)?游戏|开始挑战|开始抢座|点击开始|开始冒险|立即开始|进入游戏|创建房间|加入房间|快速开局|单机练习|\b(?:start(?: game)?|play(?: now)?|continue(?: game)?|new game|create room|join room)\b/i;
    const selector = script.dataset.startSelector;
    if (!(selector && target.closest(selector)) && !match.test(label)) return;
    activated = true;
    play();
  }, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else play(); });
  window.addEventListener('pagehide', stop);
  window.addEventListener('pageshow', play);
  for (const event of ['playing', 'pause', 'error']) track.addEventListener(event, refresh);
  document.body.appendChild(button);
  refresh();
})();

/*
 * player.jeex.org page script. Vanilla, no dependencies, loaded with `defer`.
 * Everything the pages say is in the HTML; this file only adds behaviour.
 */

// Mobile menu: the popover handles light dismiss and Escape; keep the button state in sync.
(function () {
  var menu = document.getElementById('menu');
  var btn = document.querySelector('.menu-btn');
  if (!menu || !btn || typeof menu.showPopover !== 'function') return;
  menu.addEventListener('toggle', function (e) {
    btn.setAttribute('aria-expanded', e.newState === 'open' ? 'true' : 'false');
  });
  menu.addEventListener('click', function (e) {
    if (e.target.closest('a')) menu.hidePopover();
  });
  window.matchMedia('(min-width: 1021px)').addEventListener('change', function (m) {
    if (m.matches && menu.matches(':popover-open')) menu.hidePopover();
  });
})();

// Live demo in the hero. The stage holds a poster and an "Explore the apartment"
// button; this replaces the poster with a frame of the demo build's
// `embed.html` (the stage's `data-demo-src`). One activation function serves
// both roads: an automatic mount once the hero is visible on a wide screen with
// a fine pointer, and the visitor's own press everywhere else. The automatic
// mount never moves focus. Once a frame is mounted, a fullscreen control puts
// the stage on the whole screen (the viewer's own fullscreen button inside the
// frame keeps working: the browser nests the two, and Escape leaves both).
(function () {
  var FRAME_TITLE = 'Interactive demo apartment';
  var AUTO_QUERY = '(min-width: 1020px) and (pointer: fine)';

  function parts(slot) {
    return {
      stage: slot.querySelector('[data-demo-stage]'),
      open: slot.querySelector('[data-demo-stage] [data-demo-open]'),
      close: slot.querySelector('[data-demo-close]'),
      full: slot.querySelector('[data-demo-fullscreen]'),
    };
  }

  function hasWebGL() {
    try {
      var canvas = document.createElement('canvas');
      var gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (!gl) return false;
      var lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      return true;
    } catch (e) {
      return false;
    }
  }

  // Element fullscreen without a prefix: Chrome 71, Firefox 64, Safari 16.4.
  // iPhone Safari has none (fullscreenEnabled is undefined): no control there.
  function canFullscreen(stage) {
    return document.fullscreenEnabled === true && typeof stage.requestFullscreen === 'function';
  }

  // True only on a wide screen with a fine pointer, without reduced motion and without Save-Data.
  function shouldAutoMount() {
    var connection = navigator.connection;
    return window.matchMedia(AUTO_QUERY).matches &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
      !(connection && connection.saveData);
  }

  // Idempotent: a second call while a frame exists mounts nothing new, but a
  // visitor's press still brings the frame that is already there into view.
  function mountDemo(slot, focus) {
    var p = parts(slot);
    var frame = p.stage.querySelector('iframe');
    if (!frame) {
      frame = document.createElement('iframe');
      frame.title = FRAME_TITLE;
      frame.setAttribute('allow', 'fullscreen');
      frame.src = p.stage.getAttribute('data-demo-src');
      // The poster stays until the frame has loaded; only then does the live frame replace it.
      frame.addEventListener('load', function () {
        if (frame.isConnected) {
          p.stage.classList.remove('is-loading');
          p.stage.classList.add('is-live');
        }
      });
      p.stage.classList.add('is-loading');
      p.stage.appendChild(frame);
      p.close.hidden = false;
      p.full.hidden = !canFullscreen(p.stage);
    }
    if (!focus) return;
    // The visitor asked for it: bring the whole demo into view, then hand it the keyboard.
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    slot.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    frame.focus({ preventScroll: true });
  }

  function unmountDemo(slot) {
    var p = parts(slot);
    var frame = p.stage.querySelector('iframe');
    if (!frame) return;
    var hadFocus = slot.contains(document.activeElement);
    frame.remove();
    p.stage.classList.remove('is-live', 'is-loading');
    p.close.hidden = true;
    p.full.hidden = true;
    if (hadFocus) p.open.focus();
  }

  var slot = document.querySelector('[data-demo]');
  if (!slot) return;
  var p = parts(slot);
  if (!p.stage || !p.open || !p.close || !p.full || !p.stage.hasAttribute('data-demo-src')) return;
  // Without WebGL the frame would only show the viewer's error card: keep the
  // poster and its caption, and offer nothing that cannot work.
  if (!hasWebGL()) return;

  p.open.hidden = false;
  var dismissed = false;

  document.querySelectorAll('[data-demo-open]').forEach(function (opener) {
    opener.addEventListener('click', function (e) {
      e.preventDefault();
      dismissed = false;
      mountDemo(slot, true);
    });
  });
  p.close.addEventListener('click', function () {
    dismissed = true;
    unmountDemo(slot);
  });

  // Fullscreen. The stage is the fullscreen element; the frame inside it may
  // put its own viewer root on top (the viewer's button), which the browser
  // stacks above the stage and unwinds on exit. The control reflects only the
  // stage: its label reads "Exit fullscreen" while the stage itself is the
  // fullscreen element (a label that changes, so no `aria-pressed` on top).
  var label = p.full.querySelector('[data-fullscreen-label]');
  var stageWasFull = false;
  p.full.addEventListener('click', function () {
    if (document.fullscreenElement === p.stage) {
      document.exitFullscreen().catch(function () {
        // Already left (Escape raced the click): the change event has updated the control.
      });
      return;
    }
    p.stage.requestFullscreen().catch(function () {
      // Refused (a permissions policy, a headless browser): the control stays as it was.
    });
  });
  document.addEventListener('fullscreenchange', function () {
    var full = document.fullscreenElement;
    var stageFull = full === p.stage;
    if (label) label.textContent = stageFull ? 'Exit fullscreen' : 'Fullscreen';
    var frame = p.stage.querySelector('iframe');
    // Entering: the keyboard goes to the viewer, which is all there is on screen.
    if (stageFull && !stageWasFull && frame) frame.focus({ preventScroll: true });
    // Leaving everything: focus comes back to the control that started it.
    if (full === null && stageWasFull && !p.full.hidden) p.full.focus({ preventScroll: true });
    if (full === null || stageFull) stageWasFull = stageFull;
  });

  if (!shouldAutoMount() || !('IntersectionObserver' in window)) return;
  var io = new IntersectionObserver(function (entries) {
    if (!entries.some(function (e) { return e.isIntersecting; })) return;
    io.disconnect();
    if (!dismissed && shouldAutoMount()) mountDemo(slot, false);
  }, { threshold: 0.25 });
  io.observe(slot);
})();

// "Give this to your AI agent": copy the prompt with the Clipboard API. Without
// script, or without a secure context, the button stays hidden and the prompt
// is plain text that selects in one click (`user-select: all`).
(function () {
  var RESET_MS = 2000;
  document.querySelectorAll('[data-copy]').forEach(function (box) {
    var button = box.querySelector('[data-copy-button]');
    var text = box.querySelector('[data-copy-text]');
    var label = box.querySelector('[data-copy-label]');
    var status = box.querySelector('[data-copy-status]');
    if (!button || !text || !label || !status) return;
    if (!window.isSecureContext || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') return;
    var idle = label.textContent;
    var timer = 0;
    function show(copied, message) {
      button.classList.toggle('is-copied', copied);
      label.textContent = copied ? 'Copied' : idle;
      status.textContent = message;
      window.clearTimeout(timer);
      if (copied) {
        timer = window.setTimeout(function () {
          button.classList.remove('is-copied');
          label.textContent = idle;
          status.textContent = '';
        }, RESET_MS);
      }
    }
    button.hidden = false;
    button.addEventListener('click', function () {
      navigator.clipboard.writeText(text.textContent.trim()).then(function () {
        show(true, 'Prompt copied to the clipboard.');
      }, function () {
        // Refused (no permission, no focus): select the text so a manual copy is one keystroke.
        var range = document.createRange();
        range.selectNodeContents(text);
        var selection = window.getSelection();
        if (selection) {
          selection.removeAllRanges();
          selection.addRange(range);
        }
        show(false, 'Copying was refused: the prompt is selected, copy it with your keyboard.');
      });
    });
  });
})();

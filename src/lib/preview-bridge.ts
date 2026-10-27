/**
 * Injected into every HTML document served by the virtual dev server. It runs
 * before the project's own modules, reports failures to the host through
 * `window.top.postMessage`, and never lets diagnostics break the preview.
 *
 * Keep this script dependency-free and classic (no modules): it executes in
 * the preview iframe, not in the IDE bundle.
 */
export const PREVIEW_BRIDGE_ATTRIBUTE = 'data-forge-preview-bridge';
export const PREVIEW_MESSAGE_SOURCE = 'forge-preview';

export const PREVIEW_ERROR_BRIDGE = String.raw`
(function () {
  if (window.__forgePreviewBridge) return;
  window.__forgePreviewBridge = true;
  var recent = {};

  function clip(value, max) {
    var text;
    try {
      text = typeof value === 'string' ? value : String(value);
    } catch (error) {
      text = 'Unserializable value';
    }
    return text.length > max ? text.slice(0, max) + '…' : text;
  }

  function describe(value) {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.name + ': ' + value.message;
    if (value && typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch (error) {
        return Object.prototype.toString.call(value);
      }
    }
    return String(value);
  }

  function send(level, message, stack, source, line, column) {
    try {
      var key = level + '|' + message + '|' + (source || '') + '|' + (line || 0) + '|' + (column || 0);
      var now = Date.now();
      if (recent[key] && now - recent[key] < 1200) return;
      recent[key] = now;
      if (!window.top || window.top === window) return;
      window.top.postMessage({
        source: 'forge-preview',
        type: 'preview-error',
        level: level,
        message: clip(message, 1600),
        stack: stack ? clip(String(stack), 3000) : undefined,
        file: source ? clip(String(source), 500) : undefined,
        line: typeof line === 'number' ? line : undefined,
        column: typeof column === 'number' ? column : undefined,
        at: now
      }, '*');
    } catch (error) {
      // Diagnostics must never break the page they observe.
    }
  }

  window.addEventListener('error', function (event) {
    try {
      var target = event.target;
      if (target && target !== window && (target.currentSrc || target.src || target.href)) {
        var url = target.currentSrc || target.src || target.href;
        send('resource', 'Failed to load ' + (target.tagName ? target.tagName.toLowerCase() : 'resource') + ': ' + url, '', url);
        return;
      }
      var error = event.error;
      send(
        'error',
        event.message || (error && error.message) || 'Script error',
        error && error.stack,
        event.filename,
        event.lineno,
        event.colno
      );
    } catch (error) {}
  }, true);

  window.addEventListener('unhandledrejection', function (event) {
    try {
      var reason = event.reason;
      send('unhandledrejection', 'Unhandled rejection: ' + describe(reason), reason && reason.stack);
    } catch (error) {}
  });

  if (window.console) {
    if (typeof window.console.error === 'function') {
      var originalError = window.console.error;
      window.console.error = function () {
        try {
          var parts = [];
          for (var index = 0; index < arguments.length; index++) parts.push(describe(arguments[index]));
          send('console', parts.join(' '));
        } catch (error) {}
        return originalError.apply(window.console, arguments);
      };
    }
    if (typeof window.console.warn === 'function') {
      var originalWarn = window.console.warn;
      window.console.warn = function () {
        try {
          var parts = [];
          for (var index = 0; index < arguments.length; index++) parts.push(describe(arguments[index]));
          send('warn', parts.join(' '));
        } catch (error) {}
        return originalWarn.apply(window.console, arguments);
      };
    }
  }

  if (typeof window.fetch === 'function') {
    var originalFetch = window.fetch;
    window.fetch = function (input, init) {
      var requestUrl = typeof input === 'string'
        ? input
        : input && input.url
          ? input.url
          : String(input);
      return originalFetch.apply(this, arguments).then(function (response) {
        try {
          if (!response.ok) {
            send(
              'network',
              'HTTP ' + response.status + ' ' + (response.statusText || '') + ' — ' + requestUrl,
              '',
              requestUrl
            );
          }
        } catch (error) {}
        return response;
      }, function (error) {
        try {
          send('network', 'Request failed — ' + requestUrl + ' — ' + describe(error), error && error.stack, requestUrl);
        } catch (sendError) {}
        throw error;
      });
    };
  }

  if (window.XMLHttpRequest) {
    var originalOpen = window.XMLHttpRequest.prototype.open;
    var originalSend = window.XMLHttpRequest.prototype.send;
    window.XMLHttpRequest.prototype.open = function (method, url) {
      this.__forgeUrl = url;
      return originalOpen.apply(this, arguments);
    };
    window.XMLHttpRequest.prototype.send = function () {
      var xhr = this;
      try {
        xhr.addEventListener('loadend', function () {
          try {
            if (xhr.status >= 400) {
              send('network', 'HTTP ' + xhr.status + ' — ' + (xhr.__forgeUrl || 'XMLHttpRequest'), '', xhr.__forgeUrl);
            }
          } catch (error) {}
        });
      } catch (error) {}
      return originalSend.apply(this, arguments);
    };
  }
})();
`;

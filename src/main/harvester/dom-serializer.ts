/**
 * Composed-DOM serialisation for the Markdown harvester.
 *
 * `document.documentElement.outerHTML` stops at the shadow boundary: a
 * `<faceplate-text-input>` serialises as an empty host tag, so every control
 * inside a web component disappears from the construct. That is not a rare
 * edge case — login and signup forms are among the most common targets for an
 * agent, and they are increasingly built from custom elements.
 *
 * This serialiser walks the *composed* tree instead: light children first,
 * then the contents of any open shadow root, recursively. It also bakes live
 * form state into the markup (which `outerHTML` cannot see, because `value` and
 * `checked` are properties, not attributes) and drops attributes that only add
 * bytes — class lists, inline styles, event handlers, resource hints.
 *
 * Password values are never serialised; only their length is recorded.
 */

export interface ComposedDom {
  html: string;
  /** Number of open shadow roots inlined (0 = the page has no web components). */
  shadowRoots: number;
}

/**
 * JS evaluated in the page. Must stay self-contained: no imports, no template
 * literals (the source is embedded in a string).
 */
export const COMPOSE_DOM_SCRIPT = `
(() => {
  var SKIP = { script:1, style:1, noscript:1, template:1, link:1, meta:1, svg:1, canvas:1,
               iframe:1, object:1, embed:1, video:1, audio:1, source:1, track:1, base:1 };
  var VOID = { input:1, br:1, img:1, hr:1, wbr:1 };
  var DROP_ATTR = { class:1, style:1, srcset:1, sizes:1, nonce:1, integrity:1, crossorigin:1,
                    referrerpolicy:1, loading:1, decoding:1, fetchpriority:1, tabindex:1 };

  var out = [];
  var shadowRoots = 0;

  // Form controls that are not rendered are not part of what the user reads:
  // hidden CSRF inputs and recaptcha response textareas (which hold multi-KB
  // tokens) would otherwise dominate the construct.
  var CONTROL = { input:1, select:1, textarea:1 };

  function isRendered(el) {
    if (el.hasAttribute && el.hasAttribute('hidden')) return false;
    if (typeof el.checkVisibility === 'function') {
      try {
        return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
      } catch {
        // older Chromium: fall through to the geometry check
      }
    }
    return el.getClientRects().length > 0;
  }

  function escText(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escAttr(s) {
    return escText(s).replace(/"/g, '&quot;');
  }

  function attributesOf(el, tag) {
    var attrs = {};
    var list = el.attributes;
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (DROP_ATTR[a.name] || a.name.indexOf('on') === 0) continue;
      // value/checked/selected are rebaked below from live state.
      if (a.name === 'value' || a.name === 'checked' || a.name === 'selected') continue;
      attrs[a.name] = a.value;
    }

    if (tag === 'input') {
      var type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'checkbox' || type === 'radio') {
        if (el.checked) attrs.checked = '';
      } else if (type === 'password') {
        // Never leak secrets into a construct that may be logged or indexed.
        if (el.value) attrs['data-filled'] = String(el.value.length);
      } else if (el.value) {
        attrs.value = el.value;
      }
    }

    if (tag === 'select') {
      var chosen = el.selectedOptions && el.selectedOptions[0];
      if (chosen) attrs.value = chosen.value || chosen.text;
    }

    if (tag === 'option') {
      if (el.selected) attrs.selected = '';
      if (el.value) attrs.value = el.value;
    }

    return attrs;
  }

  function writeAttrs(attrs) {
    for (var k in attrs) {
      if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
      out.push(' ' + k + '="' + escAttr(attrs[k]) + '"');
    }
  }

  function serialize(node) {
    if (node.nodeType === 3) {
      out.push(escText(node.nodeValue));
      return;
    }
    if (node.nodeType !== 1) return;

    var el = node;
    var tag = el.tagName.toLowerCase();
    if (SKIP[tag]) return;
    // Hidden nodes are not part of what the user sees; their text is noise.
    if (el.hasAttribute && el.hasAttribute('hidden')) return;
    if (CONTROL[tag] && !isRendered(el)) return;
    if (tag === 'input' && (el.getAttribute('type') || '').toLowerCase() === 'hidden') return;

    out.push('<' + tag);
    writeAttrs(attributesOf(el, tag));

    if (VOID[tag]) {
      out.push('>');
      return;
    }

    out.push('>');

    if (tag === 'textarea') {
      if (el.value) out.push(escText(el.value));
    } else {
      var kids = el.childNodes;
      for (var i = 0; i < kids.length; i++) serialize(kids[i]);
    }

    // Then the rendered shadow tree, recursively. Slotted light children are
    // already emitted above, and a <slot> itself has no children, so nothing is
    // duplicated for the usual custom-element shape.
    var shadow = el.shadowRoot;
    if (shadow) {
      shadowRoots++;
      for (var j = 0; j < shadow.childNodes.length; j++) serialize(shadow.childNodes[j]);
    }

    out.push('</' + tag + '>');
  }

  serialize(document.body || document.documentElement);
  return { html: out.join(''), shadowRoots: shadowRoots };
})()
`;

interface ExecutableWebContents {
  executeJavaScript: (code: string) => Promise<unknown>;
}

/** Serialise the active page's composed DOM (light + open shadow roots). */
export async function captureComposedDom(wc: ExecutableWebContents): Promise<ComposedDom> {
  try {
    const res = (await wc.executeJavaScript(COMPOSE_DOM_SCRIPT)) as ComposedDom | null;
    if (res && typeof res.html === 'string' && res.html.length > 0) {
      return { html: res.html, shadowRoots: Number(res.shadowRoots) || 0 };
    }
  } catch {
    // fall through to the plain serialisation below
  }
  const html = (await wc.executeJavaScript('document.documentElement.outerHTML').catch(() => '')) as string;
  return { html: html || '', shadowRoots: 0 };
}

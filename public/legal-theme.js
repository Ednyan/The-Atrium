// The light/dark switch for the privacy and terms pages.
//
// A file rather than an inline <script> because the site's CSP is
// `script-src 'self' blob:` with no 'unsafe-inline' (see public/_headers).
// Inline blocks on these two pages were silently blocked: the theme never
// applied, the button did nothing, and the pages sat in whatever the
// stylesheet happened to define first. Loosening the policy for the whole
// site to run twenty lines here would be the wrong trade.
//
// Loaded from <head> without defer, so the stored choice is on the element
// before anything paints and there is no flash of the wrong colour.
//
// Two states and a dark default, matching the app (src/lib/useLandingTheme.ts).
// These pages are reached from the app and open in a tab of their own, so they
// have to agree with it about what "no choice yet" means -- and it means dark,
// not whatever the machine prefers.
//
// Storage matches the app too: sessionStorage on the web, so a choice holds
// for the visit and the next one opens dark again. These pages only ever run
// in a browser, so there is no desktop branch to mirror.
(function () {
  var KEY = 'atrium_landing_theme'
  var root = document.documentElement

  function store() {
    try {
      return window.sessionStorage
    } catch (e) {
      return null
    }
  }

  function stored() {
    try {
      var value = store() && store().getItem(KEY)
      return value === 'light' || value === 'dark' ? value : null
    } catch (e) {
      return null
    }
  }

  var choice = stored()

  function resolved() {
    return choice || 'dark'
  }

  // Always written, because there is no longer a "let the stylesheet decide"
  // state -- dark is the answer until somebody says otherwise, and the
  // attribute is what says so.
  function paint() {
    root.setAttribute('data-theme', resolved())
  }

  paint()

  function wire() {
    var button = document.getElementById('theme-toggle')
    var glyph = document.getElementById('theme-glyph')
    var label = document.getElementById('theme-label')

    function render() {
      paint()
      var text = resolved() === 'dark' ? 'Dark' : 'Light'
      if (glyph) glyph.textContent = resolved() === 'dark' ? '☾' : '☀'
      if (label) label.textContent = text
      if (button) {
        button.title = 'Theme: ' + text
        button.setAttribute('aria-label', 'Theme: ' + text + '. Click to change.')
      }
    }

    if (button) {
      button.addEventListener('click', function () {
        choice = resolved() === 'dark' ? 'light' : 'dark'
        try {
          if (store()) store().setItem(KEY, choice)
        } catch (e) {}
        render()
      })
    }

    render()

    // Leaving plays the same recede the app's screens do, rather than cutting
    // straight to the next page.
    var page = document.querySelector('.page')
    document.addEventListener('click', function (event) {
      var link = event.target && event.target.closest ? event.target.closest('a[href]') : null
      if (!link || !page) return
      var href = link.getAttribute('href') || ''
      if (link.target === '_blank' || href.charAt(0) === '#' || href.indexOf('mailto:') === 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
      event.preventDefault()
      page.classList.add('leaving')
      setTimeout(function () { window.location.href = href }, 240)
    })
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire)
  else wire()
})()

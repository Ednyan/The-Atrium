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
// The same key, the same three states and the same cycle as the app
// (src/lib/useLandingTheme.ts, src/components/ThemeToggle.tsx). Auto follows
// the machine and is not the same as having picked whichever mode the machine
// is in today: a laptop that turns dark at sunset should turn with it, and
// that only works if "no choice" is itself a state.
(function () {
  var KEY = 'atrium_landing_theme'
  var root = document.documentElement
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null

  function stored() {
    try {
      var value = localStorage.getItem(KEY)
      return value === 'light' || value === 'dark' ? value : null
    } catch (e) {
      return null
    }
  }

  var choice = stored()

  function system() {
    return media && media.matches ? 'dark' : 'light'
  }

  function resolved() {
    return choice || system()
  }

  // Only an explicit choice is written to the element. With nothing set, the
  // stylesheet's own prefers-color-scheme block decides -- which is what keeps
  // these pages correct even if this file never runs at all.
  function paint() {
    if (choice) root.setAttribute('data-theme', choice)
    else root.removeAttribute('data-theme')
  }

  paint()

  function wire() {
    var button = document.getElementById('theme-toggle')
    var glyph = document.getElementById('theme-glyph')
    var label = document.getElementById('theme-label')

    function render() {
      paint()
      var text = choice ? (choice === 'dark' ? 'Dark' : 'Light') : 'Auto · ' + system()
      if (glyph) glyph.textContent = choice ? (resolved() === 'dark' ? '☾' : '☀') : '◐'
      if (label) label.textContent = text
      if (button) {
        button.title = 'Theme: ' + text
        button.setAttribute('aria-label', 'Theme: ' + text + '. Click to change.')
      }
    }

    if (media && media.addEventListener) media.addEventListener('change', render)

    // These pages open in a tab of their own, so the app is sitting in the one
    // behind. Without this, a choice made here would not reach it until that
    // tab was reloaded.
    window.addEventListener('storage', function (event) {
      if (event.key !== KEY) return
      choice = event.newValue === 'light' || event.newValue === 'dark' ? event.newValue : null
      render()
    })

    if (button) {
      button.addEventListener('click', function () {
        // Whatever you are looking at, its opposite, then back to following
        // the machine.
        choice = choice ? (choice === 'dark' ? 'light' : null) : (system() === 'dark' ? 'light' : 'dark')
        try {
          if (choice) localStorage.setItem(KEY, choice)
          else localStorage.removeItem(KEY)
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

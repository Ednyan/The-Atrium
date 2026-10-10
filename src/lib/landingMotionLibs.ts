// GSAP, with the plugins the landing page uses, and Lenis: a chunk of their
// own, which lib/landingMotion fetches once the page has painted.
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin'
import Lenis from 'lenis'
import 'lenis/dist/lenis.css'

gsap.registerPlugin(ScrollTrigger, SplitText, ScrambleTextPlugin)
// The landing page scrolls in a box of its own, not the window. A selector,
// looked up as each trigger is made, so it's there whichever effect runs
// first -- looked up in the whole page, so no gsap.context() here may be
// given a scope: inside one, a selector is looked for within the scope alone.
ScrollTrigger.defaults({ scroller: '[data-landing-scroller]' })

export { gsap, ScrollTrigger, SplitText, Lenis }

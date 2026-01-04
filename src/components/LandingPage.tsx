import { useState, useEffect, useMemo, useRef } from 'react'

interface LandingPageProps {
  onGetStarted: () => void
}

interface Section {
  id: string
  title: string
  subtitle: string
}

const sections: Section[] = [
  { id: 'hero', title: 'The Digital Atrium', subtitle: 'A shared space for collective expression' },
  { id: 'what', title: 'What Is This', subtitle: 'The concept behind the atrium' },
  { id: 'how', title: 'How It Works', subtitle: 'Navigate, create, collaborate' },
  { id: 'who', title: 'Who Am I', subtitle: 'The creator behind the project' },
]

export default function LandingPage({ onGetStarted }: LandingPageProps) {
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const [activeSection, setActiveSection] = useState(0)
  const [scrollProgress, setScrollProgress] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const sectionRefs = useRef<(HTMLElement | null)[]>([])

  // Memoize particle positions (fireflies)
  const particles = useMemo(() => 
    [...Array(20)].map((_, i) => ({
      left: `${(i * 17 + 3) % 96}%`,
      top: `${(i * 23 + 5) % 94}%`,
      duration: 8 + (i * 1.5) % 6,
      delay: i * 0.5,
    })), []
  )

  // Memoize background rectangles (trace-like elements)
  const backgroundRects = useMemo(() => 
    [...Array(15)].map((_, i) => ({
      left: `${(i * 19 + 7) % 90}%`,
      top: `${(i * 31 + 12) % 85}%`,
      width: 40 + (i * 17) % 120,
      height: 20 + (i * 13) % 60,
      rotation: (i * 7) % 15 - 7,
      delay: i * 0.3,
    })), []
  )

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY })
    }
    
    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])

  useEffect(() => {
    const handleScroll = () => {
      if (!containerRef.current) return
      
      const scrollTop = containerRef.current.scrollTop
      const scrollHeight = containerRef.current.scrollHeight - containerRef.current.clientHeight
      const progress = scrollTop / scrollHeight
      setScrollProgress(progress)

      // Determine active section
      let currentSection = 0
      sectionRefs.current.forEach((ref, index) => {
        if (ref) {
          const rect = ref.getBoundingClientRect()
          if (rect.top <= window.innerHeight / 2) {
            currentSection = index
          }
        }
      })
      setActiveSection(currentSection)
    }

    const container = containerRef.current
    container?.addEventListener('scroll', handleScroll)
    return () => container?.removeEventListener('scroll', handleScroll)
  }, [])

  const scrollToSection = (index: number) => {
    sectionRefs.current[index]?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <div 
      ref={containerRef}
      className="h-screen bg-nier-black text-nier-bg overflow-y-auto overflow-x-hidden scroll-smooth"
    >
      {/* Fixed overlays */}
      {/* Scanline overlay */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.02] z-50"
        style={{
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(218, 212, 187, 0.1) 2px, rgba(218, 212, 187, 0.1) 4px)',
        }}
      />

      {/* Animated background grid */}
      <div 
        className="fixed inset-0 pointer-events-none opacity-10"
        style={{
          backgroundImage: `
            linear-gradient(rgba(218, 212, 187, 0.15) 1px, transparent 1px),
            linear-gradient(90deg, rgba(218, 212, 187, 0.15) 1px, transparent 1px)
          `,
          backgroundSize: '60px 60px',
          transform: `translate(${mousePos.x * 0.01}px, ${mousePos.y * 0.01}px)`,
          transition: 'transform 0.5s ease-out',
        }}
      />

      {/* Background rectangles (trace-like elements) */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        {backgroundRects.map((rect, i) => (
          <div
            key={i}
            className="absolute border border-nier-border/[0.08] bg-nier-border/[0.02]"
            style={{
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
              transform: `rotate(${rect.rotation}deg)`,
              animation: `rectFloat ${12 + i % 5}s ease-in-out infinite`,
              animationDelay: `${rect.delay}s`,
            }}
          >
            {/* Corner accents on some rectangles */}
            {i % 3 === 0 && (
              <>
                <div className="absolute -top-px -left-px w-2 h-2 border-l border-t border-nier-border/20" />
                <div className="absolute -bottom-px -right-px w-2 h-2 border-r border-b border-nier-border/20" />
              </>
            )}
          </div>
        ))}
      </div>

      {/* Floating particles (fireflies) */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        {particles.map((particle, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 bg-nier-border rounded-full opacity-0"
            style={{
              left: particle.left,
              top: particle.top,
              animation: `firefly ${particle.duration}s ease-in-out infinite`,
              animationDelay: `${particle.delay}s`,
            }}
          />
        ))}
      </div>

      {/* Section indicators (Nier-style, on the right) */}
      <div className="fixed right-8 top-1/2 -translate-y-1/2 z-40 flex flex-col items-end gap-6">
        {sections.map((section, index) => {
          const isActive = activeSection === index
          const distance = Math.abs(activeSection - index)
          
          return (
            <button
              key={section.id}
              onClick={() => scrollToSection(index)}
              className="group flex items-center gap-3 transition-all duration-300"
            >
              {/* Section label (shows on hover or when active) */}
              <span 
                className={`text-[10px] tracking-[0.15em] uppercase transition-all duration-300 ${
                  isActive 
                    ? 'text-nier-bg opacity-100' 
                    : 'text-nier-border/60 opacity-0 group-hover:opacity-100'
                }`}
              >
                {section.title}
              </span>
              
              {/* Indicator bracket */}
              <div className={`relative transition-all duration-300 ${isActive ? 'scale-110' : 'scale-100'}`}>
                {/* Outer brackets */}
                <div className={`w-6 h-6 transition-all duration-300 ${
                  isActive ? 'opacity-100' : 'opacity-40 group-hover:opacity-70'
                }`}>
                  <div className="absolute top-0 left-0 w-2 h-2 border-l border-t border-nier-border/80" />
                  <div className="absolute top-0 right-0 w-2 h-2 border-r border-t border-nier-border/80" />
                  <div className="absolute bottom-0 left-0 w-2 h-2 border-l border-b border-nier-border/80" />
                  <div className="absolute bottom-0 right-0 w-2 h-2 border-r border-b border-nier-border/80" />
                </div>
                
                {/* Center diamond */}
                <div 
                  className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rotate-45 transition-all duration-300 ${
                    isActive 
                      ? 'bg-nier-bg border-nier-bg' 
                      : 'bg-transparent border border-nier-border/60 group-hover:border-nier-border'
                  }`}
                />
                
                {/* Distance line (when not active) */}
                {distance > 0 && (
                  <div 
                    className="absolute left-1/2 -translate-x-1/2 w-px bg-nier-border/20"
                    style={{
                      top: index < activeSection ? '-24px' : '100%',
                      height: `${Math.min(distance * 8, 16)}px`,
                    }}
                  />
                )}
              </div>
            </button>
          )
        })}
        
        {/* Progress indicator */}
        <div className="mt-4 flex flex-col items-end gap-1 pr-[11px]">
          <div className="w-px h-16 bg-nier-border/20 relative">
            <div 
              className="absolute top-0 left-0 w-full bg-nier-border/60 transition-all duration-300"
              style={{ height: `${scrollProgress * 100}%` }}
            />
          </div>
          <span className="text-[8px] text-nier-border/50 tracking-widest -mr-2">
            {Math.round(scrollProgress * 100)}%
          </span>
        </div>
      </div>

      {/* SECTION 1: Hero */}
      <section 
        ref={el => sectionRefs.current[0] = el}
        className="min-h-screen flex flex-col items-center justify-center px-6 relative"
      >
        {/* Corner brackets */}
        <div className="absolute top-8 left-8 w-16 h-16 border-l-2 border-t-2 border-nier-border/30" />
        <div className="absolute top-8 right-8 w-16 h-16 border-r-2 border-t-2 border-nier-border/30" />
        <div className="absolute bottom-8 left-8 w-16 h-16 border-l-2 border-b-2 border-nier-border/30" />
        <div className="absolute bottom-8 right-8 w-16 h-16 border-r-2 border-b-2 border-nier-border/30" />

        <div className="text-center max-w-3xl">
          <div className="flex items-center justify-center gap-4 mb-6">
            <div className="w-12 h-[1px] bg-gradient-to-r from-transparent to-nier-border/50" />
            <span className="text-nier-border/70 text-xs tracking-[0.3em] uppercase">A Shared Canvas Experience</span>
            <div className="w-12 h-[1px] bg-gradient-to-l from-transparent to-nier-border/50" />
          </div>
          
          <h1 className="text-5xl md:text-7xl lg:text-8xl font-extralight tracking-wider mb-6">
            <span className="text-nier-border/60">THE</span>{' '}
            <span className="text-white">DIGITAL</span>
            <br />
            <span className="text-white">ATRIUM</span>
          </h1>
          
          <p className="text-nier-border text-lg md:text-xl font-light tracking-wide mb-4">
            A curated space where ideas converge and art coexists.
          </p>
          <p className="text-nier-border/60 text-sm md:text-base font-light tracking-wide mb-12">
            Enter the atrium. Leave your mark. Discover others.
          </p>

          {/* Feature highlights */}
          <div className="flex flex-wrap justify-center gap-8 mb-12 text-xs tracking-[0.15em] uppercase text-nier-border/50">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rotate-45 bg-nier-border/40" />
              <span>Infinite Canvas</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rotate-45 bg-nier-border/40" />
              <span>Private Atriums</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rotate-45 bg-nier-border/40" />
              <span>Live Presence</span>
            </div>
          </div>

          {/* Diamond separator */}
          <div className="flex items-center justify-center gap-3 mb-12">
            <div className="w-2 h-2 rotate-45 border border-nier-border/40" />
            <div className="w-3 h-3 rotate-45 border border-nier-border/60 bg-nier-blackLight" />
            <div className="w-2 h-2 rotate-45 border border-nier-border/40" />
          </div>

          {/* CTA Button */}
          <button
            onClick={onGetStarted}
            className="group relative px-12 py-4 bg-transparent border border-nier-border/50 hover:border-nier-bg hover:bg-nier-bg/5 transition-all duration-300"
          >
            <div className="absolute -top-1 -left-1 w-3 h-3 border-l border-t border-nier-border/60 group-hover:border-nier-bg transition-colors" />
            <div className="absolute -top-1 -right-1 w-3 h-3 border-r border-t border-nier-border/60 group-hover:border-nier-bg transition-colors" />
            <div className="absolute -bottom-1 -left-1 w-3 h-3 border-l border-b border-nier-border/60 group-hover:border-nier-bg transition-colors" />
            <div className="absolute -bottom-1 -right-1 w-3 h-3 border-r border-b border-nier-border/60 group-hover:border-nier-bg transition-colors" />
            
            <span className="text-sm tracking-[0.2em] uppercase text-nier-border group-hover:text-nier-bg transition-colors">
              ◇ Enter The Atrium
            </span>
          </button>

          <p className="mt-8 text-nier-border/40 text-xs tracking-wider">
            Free to use • No credit card required
          </p>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-12 inset-x-0 flex justify-center">
          <div className="flex flex-col items-center gap-2 animate-pulse">
            <span className="text-[10px] text-nier-border/40 tracking-[0.2em] uppercase">Scroll</span>
            <div className="w-px h-8 bg-gradient-to-b from-nier-border/40 to-transparent" />
          </div>
        </div>
      </section>

      {/* SECTION 2: What Is This */}
      <section 
        ref={el => sectionRefs.current[1] = el}
        className="min-h-screen flex items-center justify-center px-6 py-24 relative"
      >
        <div className="max-w-4xl mx-auto">
          {/* Section header */}
          <div className="flex items-center gap-4 mb-12">
            <div className="w-3 h-3 rotate-45 border border-nier-border/60" />
            <h2 className="text-3xl md:text-4xl font-extralight tracking-[0.15em] uppercase text-white">
              What Is This
            </h2>
            <div className="flex-1 h-px bg-gradient-to-r from-nier-border/40 to-transparent" />
          </div>

          <div className="grid md:grid-cols-2 gap-12">
            <div className="space-y-6">
              <p className="text-nier-border text-lg leading-relaxed">
                <span className="text-nier-bg">The Digital Atrium</span> is a collaborative infinite canvas 
                where people gather to share, explore, and build together.
              </p>
              <p className="text-nier-border/70 leading-relaxed">
                Like a grand entrance hall in a museum, the atrium serves as a central space where 
                art, ideas, and content from many sources come together in one place. Each visitor 
                can leave their mark—a trace—for others to discover.
              </p>
              <p className="text-nier-border/70 leading-relaxed">
                Create your own private atrium for your community, or explore public spaces to see 
                what others have created. It's a living document of collective expression.
              </p>
            </div>

            <div className="space-y-4">
              <div className="border border-nier-border/30 p-6 bg-nier-black/50">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-2 h-2 rotate-45 bg-nier-border/60" />
                  <span className="text-sm tracking-[0.1em] uppercase text-nier-bg">Traces</span>
                </div>
                <p className="text-nier-border/60 text-sm leading-relaxed">
                  Leave text, embeds, or shapes anywhere on the infinite canvas. Each trace persists 
                  for others to find.
                </p>
              </div>
              
              <div className="border border-nier-border/30 p-6 bg-nier-black/50">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-2 h-2 rotate-45 bg-nier-border/60" />
                  <span className="text-sm tracking-[0.1em] uppercase text-nier-bg">Atriums</span>
                </div>
                <p className="text-nier-border/60 text-sm leading-relaxed">
                  Private or public spaces with their own infinite canvas. Invite friends or open 
                  to the world.
                </p>
              </div>
              
              <div className="border border-nier-border/30 p-6 bg-nier-black/50">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-2 h-2 rotate-45 bg-nier-border/60" />
                  <span className="text-sm tracking-[0.1em] uppercase text-nier-bg">Presence</span>
                </div>
                <p className="text-nier-border/60 text-sm leading-relaxed">
                  See others exploring the same space in real-time. A shared experience, even when apart.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 3: How It Works */}
      <section 
        ref={el => sectionRefs.current[2] = el}
        className="min-h-screen flex items-center justify-center px-6 py-24 relative"
      >
        <div className="max-w-4xl mx-auto">
          {/* Section header */}
          <div className="flex items-center gap-4 mb-12">
            <div className="w-3 h-3 rotate-45 border border-nier-border/60" />
            <h2 className="text-3xl md:text-4xl font-extralight tracking-[0.15em] uppercase text-white">
              How It Works
            </h2>
            <div className="flex-1 h-px bg-gradient-to-r from-nier-border/40 to-transparent" />
          </div>

          <div className="space-y-12">
            {/* Controls */}
            <div>
              <h3 className="text-lg tracking-[0.1em] uppercase text-white mb-6 flex items-center gap-3">
                <span className="text-nier-border/40">01</span>
                Navigation
              </h3>
              <div className="grid sm:grid-cols-3 gap-4">
                {[
                  { key: 'Click + Drag', desc: 'Pan around the canvas' },
                  { key: 'Scroll Wheel', desc: 'Zoom in and out' },
                  { key: 'T Key', desc: 'Quick-place a trace' },
                ].map((control, i) => (
                  <div key={i} className="border border-nier-border/20 p-4 bg-nier-black/30">
                    <div className="text-white text-sm font-mono mb-2">{control.key}</div>
                    <div className="text-nier-border/60 text-xs">{control.desc}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Creating traces */}
            <div>
              <h3 className="text-lg tracking-[0.1em] uppercase text-white mb-6 flex items-center gap-3">
                <span className="text-nier-border/40">02</span>
                Leaving Traces
              </h3>
              <div className="border border-nier-border/30 p-6 bg-nier-black/30">
                <p className="text-nier-border/70 leading-relaxed mb-4">
                  Click anywhere on the canvas to open the trace menu. Choose between:
                </p>
                <div className="flex flex-wrap gap-6 text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rotate-45 bg-nier-border/60" />
                    <span className="text-nier-border"><span className="text-nier-bg">Text</span> — Notes, thoughts, poetry</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rotate-45 bg-nier-border/60" />
                    <span className="text-nier-border"><span className="text-nier-bg">Embed</span> — Links, videos, content</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rotate-45 bg-nier-border/60" />
                    <span className="text-nier-border"><span className="text-nier-bg">Shape</span> — Visual elements</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Storage recommendation */}
            <div>
              <h3 className="text-lg tracking-[0.1em] uppercase text-white mb-6 flex items-center gap-3">
                <span className="text-nier-border/40">03</span>
                Adding Your Content
              </h3>
              <div className="border border-nier-border/30 p-6 bg-nier-black/30">
                <p className="text-nier-border/70 leading-relaxed mb-4">
                  The atrium connects to your content through embedded links. We recommend using free 
                  third-party platforms for hosting your media:
                </p>
                <div className="flex flex-wrap gap-4 text-sm">
                  {[
                    { name: 'YouTube', desc: 'Videos' },
                    { name: 'Pinterest', desc: 'Image boards' },
                    { name: 'Imgur', desc: 'Images' },
                    { name: 'Instagram', desc: 'Photos' },
                    { name: 'SoundCloud', desc: 'Audio' },
                  ].map((platform, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rotate-45 bg-nier-border/60" />
                      <span className="text-nier-border"><span className="text-white">{platform.name}</span> — {platform.desc}</span>
                    </div>
                  ))}
                </div>
                <p className="text-nier-border/50 text-xs mt-4 italic">
                  Simply copy the embed link or image URL from these platforms and paste it into your trace.
                </p>
              </div>
            </div>

            {/* The ecosystem */}
            <div>
              <h3 className="text-lg tracking-[0.1em] uppercase text-white mb-6 flex items-center gap-3">
                <span className="text-nier-border/40">04</span>
                The Ecosystem
              </h3>
              <div className="grid md:grid-cols-3 gap-6">
                <div className="text-center p-6">
                  <div className="w-12 h-12 mx-auto mb-4 border border-nier-border/40 rotate-45 flex items-center justify-center">
                    <span className="text-nier-bg -rotate-45 text-lg">1</span>
                  </div>
                  <h4 className="text-nier-bg text-sm tracking-wider uppercase mb-2">Create</h4>
                  <p className="text-nier-border/60 text-xs leading-relaxed">
                    Set up your atrium. Define its purpose and who can access it.
                  </p>
                </div>
                <div className="text-center p-6">
                  <div className="w-12 h-12 mx-auto mb-4 border border-nier-border/40 rotate-45 flex items-center justify-center">
                    <span className="text-nier-bg -rotate-45 text-lg">2</span>
                  </div>
                  <h4 className="text-nier-bg text-sm tracking-wider uppercase mb-2">Populate</h4>
                  <p className="text-nier-border/60 text-xs leading-relaxed">
                    Invite others or leave traces yourself. Build a collection of ideas.
                  </p>
                </div>
                <div className="text-center p-6">
                  <div className="w-12 h-12 mx-auto mb-4 border border-nier-border/40 rotate-45 flex items-center justify-center">
                    <span className="text-nier-bg -rotate-45 text-lg">3</span>
                  </div>
                  <h4 className="text-nier-bg text-sm tracking-wider uppercase mb-2">Explore</h4>
                  <p className="text-nier-border/60 text-xs leading-relaxed">
                    Navigate the infinite canvas. Discover traces left by others.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 4: Who Am I */}
      <section 
        ref={el => sectionRefs.current[3] = el}
        className="min-h-screen flex items-center justify-center px-6 py-24 relative"
      >
        <div className="max-w-3xl mx-auto text-center">
          {/* Section header */}
          <div className="flex items-center justify-center gap-4 mb-12">
            <div className="flex-1 h-px bg-gradient-to-l from-nier-border/40 to-transparent max-w-[100px]" />
            <div className="w-3 h-3 rotate-45 border border-nier-border/60" />
            <h2 className="text-3xl md:text-4xl font-extralight tracking-[0.15em] uppercase text-white">
              Who and Why?
            </h2>
            <div className="w-3 h-3 rotate-45 border border-nier-border/60" />
            <div className="flex-1 h-px bg-gradient-to-r from-nier-border/40 to-transparent max-w-[100px]" />
          </div>

          {/* Placeholder for personal content */}
          <div className="border border-nier-border/30 p-8 md:p-12 bg-nier-black/30 mb-8">
            <p className="text-nier-border/60 text-sm leading-relaxed mb-6 italic">
              [Your personal introduction goes here. Talk about yourself, your motivations 
              for creating The Digital Atrium, and what drives you.]
            </p>
            
            <div className="w-16 h-px bg-nier-border/30 mx-auto mb-6" />
            
            <p className="text-nier-border/60 text-sm leading-relaxed italic">
              [Share your story, your vision for this project, and what you hope 
              visitors will take away from their experience.]
            </p>
          </div>

          {/* Social links placeholder */}
          <div className="flex items-center justify-center gap-6">
            <span className="text-nier-border/40 text-xs tracking-[0.1em] uppercase">Connect:</span>
            {[
              { name: 'GitHub', url: '#' },
              { name: 'Twitter', url: '#' },
              { name: 'Email', url: '#' },
            ].map((social, i) => (
              <a
                key={i}
                href={social.url}
                className="text-nier-border/60 hover:text-nier-bg text-xs tracking-wider uppercase transition-colors"
              >
                ◇ {social.name}
              </a>
            ))}
          </div>

          {/* Final CTA */}
          <div className="mt-16">
            <div className="flex items-center justify-center gap-3 mb-8">
              <div className="w-2 h-2 rotate-45 border border-nier-border/40" />
              <div className="w-3 h-3 rotate-45 border border-nier-border/60 bg-nier-blackLight" />
              <div className="w-2 h-2 rotate-45 border border-nier-border/40" />
            </div>
            
            <button
              onClick={onGetStarted}
              className="group relative px-12 py-4 bg-transparent border border-nier-border/50 hover:border-nier-bg hover:bg-nier-bg/5 transition-all duration-300"
            >
              <div className="absolute -top-1 -left-1 w-3 h-3 border-l border-t border-nier-border/60 group-hover:border-nier-bg transition-colors" />
              <div className="absolute -top-1 -right-1 w-3 h-3 border-r border-t border-nier-border/60 group-hover:border-nier-bg transition-colors" />
              <div className="absolute -bottom-1 -left-1 w-3 h-3 border-l border-b border-nier-border/60 group-hover:border-nier-bg transition-colors" />
              <div className="absolute -bottom-1 -right-1 w-3 h-3 border-r border-b border-nier-border/60 group-hover:border-nier-bg transition-colors" />
              
              <span className="text-sm tracking-[0.2em] uppercase text-nier-border group-hover:text-nier-bg transition-colors">
                ◇ Begin Your Journey
              </span>
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 border-t border-nier-border/20">
        <div className="max-w-4xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="text-nier-border/40 text-xs tracking-wider">
            The Digital Atrium • {new Date().getFullYear()}
          </div>
          <div className="flex items-center gap-6 text-nier-border/40 text-xs tracking-wider">
            <span>Free to use</span>
            <span>•</span>
            <span>Open source</span>
          </div>
        </div>
      </footer>

      {/* CSS for animations */}
      <style>{`
        @keyframes firefly {
          0% { opacity: 0; transform: translateY(0px) translateX(0px); }
          10% { opacity: 0.15; }
          30% { opacity: 0.3; transform: translateY(-20px) translateX(15px); }
          50% { opacity: 0.25; transform: translateY(-50px) translateX(-10px); }
          70% { opacity: 0.35; transform: translateY(-30px) translateX(25px); }
          90% { opacity: 0.1; transform: translateY(-10px) translateX(5px); }
          100% { opacity: 0; transform: translateY(0px) translateX(0px); }
        }
        
        @keyframes rectFloat {
          0%, 100% { 
            opacity: 0.6; 
            transform: rotate(var(--rotation, 0deg)) translateY(0px); 
          }
          50% { 
            opacity: 0.9; 
            transform: rotate(var(--rotation, 0deg)) translateY(-10px); 
          }
        }
      `}</style>
    </div>
  )
}

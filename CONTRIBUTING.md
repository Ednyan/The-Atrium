# Contributing to The Lobby

Thank you for your interest in contributing to The Lobby! This document provides guidelines and instructions for contributing.

## 🎯 Ways to Contribute

- 🐛 Report bugs
- ✨ Suggest new features
- 📝 Improve documentation
- 🎨 Design new avatars or UI elements
- 🔧 Submit bug fixes
- 🚀 Add new features
- 🧪 Write tests
- 🌍 Add translations

## 🚀 Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/your-username/the-lobby.git`
3. Install dependencies: `npm install`
4. Set up Supabase following `QUICKSTART.md`
5. Create a branch: `git checkout -b feature/your-feature-name`

## 📝 Development Guidelines

### Code Style

- Use TypeScript for all new code
- Follow existing code formatting (we use Prettier)
- Use meaningful variable and function names
- Add comments for complex logic
- Keep components small and focused

### Commit Messages

Follow conventional commits format:

```
feat: add new avatar customization
fix: resolve multiplayer sync issue
docs: update setup instructions
style: improve lobby color scheme
refactor: simplify presence hook
test: add tests for trace system
```

### Component Structure

```tsx
// Imports
import { useState, useEffect } from 'react'
import { useGameStore } from '../store/gameStore'

// Types
interface ComponentProps {
  onAction: () => void
}

// Component
export default function Component({ onAction }: ComponentProps) {
  // Hooks
  const { state } = useGameStore()
  const [localState, setLocalState] = useState(false)

  // Effects
  useEffect(() => {
    // ...
  }, [])

  // Handlers
  const handleClick = () => {
    // ...
  }

  // Render
  return (
    <div>
      {/* ... */}
    </div>
  )
}
```

## 🎨 Design Guidelines

### Colors

Use the lobby color palette from `tailwind.config.js`:

- `lobby-dark`: Dark backgrounds
- `lobby-darker`: Darker backgrounds
- `lobby-accent`: Primary accent (red)
- `lobby-light`: Text and light elements
- `lobby-muted`: Muted backgrounds

### Spacing

- Use Tailwind spacing utilities
- Maintain consistent padding (4, 6, 8, 12)
- Keep UI elements breathable

## 🧪 Testing

Before submitting a PR:

1. Test locally with `npm run dev`
2. Test multiplayer in two browsers
3. Test trace creation and persistence
4. Check browser console for errors
5. Test on different screen sizes

## 📋 Pull Request Process

1. Update documentation if needed
2. Add yourself to contributors list
3. Create a pull request with:
   - Clear title and description
   - Screenshots/GIFs for UI changes
   - Link to related issues
   - List of changes made

### PR Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation update
- [ ] UI/UX improvement

## Testing
- [ ] Tested locally
- [ ] Tested multiplayer
- [ ] No console errors
- [ ] Works on mobile

## Screenshots
[Add screenshots if applicable]

## Related Issues
Closes #[issue number]
```

## 🐛 Reporting Bugs

Use the bug report template:

```markdown
**Describe the bug**
A clear description of the bug

**To Reproduce**
Steps to reproduce:
1. Go to '...'
2. Click on '...'
3. See error

**Expected behavior**
What should happen

**Screenshots**
If applicable

**Environment:**
- Browser: [e.g., Chrome 120]
- OS: [e.g., Windows 11]
- Node version: [e.g., 18.17.0]

**Additional context**
Any other information
```

## ✨ Feature Requests

Use the feature request template:

```markdown
**Is your feature related to a problem?**
Description of the problem

**Describe the solution**
How you'd like it to work

**Describe alternatives**
Other solutions you've considered

**Additional context**
Mockups, examples, etc.
```

## 🎯 Priority Features

Looking for contribution ideas? Check these:

### High Priority
- [ ] Mobile touch controls
- [ ] Custom avatar customization
- [ ] Image upload for traces
- [ ] Chat system
- [ ] Sound effects

### Medium Priority
- [ ] Private rooms
- [ ] Admin moderation tools
- [ ] User profiles
- [ ] Emoji support in traces
- [ ] Dark/light theme toggle

### Nice to Have
- [ ] Mini-games
- [ ] Avatar animations
- [ ] Background music player
- [ ] User badges/achievements
- [ ] Export lobby as image

## 📚 Resources

- [React Documentation](https://react.dev)
- [Pixi.js Documentation](https://pixijs.com/docs)
- [Supabase Documentation](https://supabase.com/docs)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)

## 🤝 Community

- Be respectful and inclusive
- Help others learn
- Share your ideas
- Have fun building!

## 📄 License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to The Lobby! 🎮✨

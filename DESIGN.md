---
name: Technical Precision
colors:
  surface: '#fcf8ff'
  surface-dim: '#dcd8e4'
  surface-bright: '#fcf8ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f6f2fe'
  surface-container: '#f0ecf8'
  surface-container-high: '#eae6f3'
  surface-container-highest: '#e4e1ed'
  on-surface: '#1b1b23'
  on-surface-variant: '#464554'
  inverse-surface: '#302f39'
  inverse-on-surface: '#f3effb'
  outline: '#777586'
  outline-variant: '#c7c4d7'
  surface-tint: '#5148d7'
  primary: '#2a14b4'
  on-primary: '#ffffff'
  primary-container: '#4338ca'
  on-primary-container: '#c1beff'
  inverse-primary: '#c3c0ff'
  secondary: '#006c4a'
  on-secondary: '#ffffff'
  secondary-container: '#82f5c1'
  on-secondary-container: '#00714e'
  tertiary: '#5c2f00'
  on-tertiary: '#ffffff'
  tertiary-container: '#7d4200'
  on-tertiary-container: '#ffb477'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e3dfff'
  primary-fixed-dim: '#c3c0ff'
  on-primary-fixed: '#100069'
  on-primary-fixed-variant: '#372abf'
  secondary-fixed: '#85f8c4'
  secondary-fixed-dim: '#68dba9'
  on-secondary-fixed: '#002114'
  on-secondary-fixed-variant: '#005137'
  tertiary-fixed: '#ffdcc3'
  tertiary-fixed-dim: '#ffb77d'
  on-tertiary-fixed: '#2f1500'
  on-tertiary-fixed-variant: '#6e3900'
  background: '#fcf8ff'
  on-background: '#1b1b23'
  surface-variant: '#e4e1ed'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  title-sm:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  code-md:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '450'
    lineHeight: 20px
  code-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  label-caps:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  container-max: 1440px
  sidebar-width: 280px
  gutter: 1rem
  stack-compact: 0.5rem
  stack-default: 1rem
  inset-squish: 0.5rem 1rem
  inset-stretch: 1rem 1.5rem
---

## Brand & Style
The design system is engineered for high-performance developer workflows. It prioritizes utility, data density, and technical clarity over decorative elements. The brand personality is authoritative, precise, and unobtrusive, mirroring the reliability of a compiler or a code editor.

The visual style blends **Minimalism** with **Modern Corporate** aesthetics, utilizing a "Developer-First" approach. This means sharp focus on legibility, consistent information hierarchy, and the use of monospaced elements to denote technical data. The interface should feel like an extension of the developer's IDE—familiar, efficient, and robust.

## Colors
The color palette is functional and semantic. The **Deep Indigo** primary color is reserved for intent-based actions and active navigation states. Semantic colors (Emerald, Amber, Rose) are used strictly for status reporting to ensure developers can scan results instantly for errors or warnings.

The neutral palette uses cool grays to maintain a "technical" atmosphere. Backgrounds use `slate-50` (#F8FAFC) to reduce eye strain during long auditing sessions, while text and heavy UI elements use `slate-900` (#0F172A) for maximum contrast.

## Typography
The system employs a dual-font strategy. **Inter** handles all UI chrome, navigation, and instructional text, providing a highly legible, neutral foundation. **JetBrains Mono** is used for all "Technical Content"—translation keys, file paths, and code snippets—to clearly distinguish between UI labels and the data being audited.

To support high information density, font sizes are slightly smaller than standard consumer apps, with `14px` serving as the primary body size and `13px` for data tables and monospaced strings.

## Layout & Spacing
This is a **desktop-first, fixed-fluid hybrid** layout. A persistent sidebar (280px) houses the primary navigation and project selector. The main content area utilizes a 12-column fluid grid but is capped at 1440px to maintain line-length readability for code and tables.

Spacing follows a strict 4px (0.25rem) baseline grid. High-density views (like the results table) use "compact" spacing to maximize the number of visible rows. Marginal space is kept tight to maintain the "tooling" feel. On mobile (rarely used for this tool), the sidebar collapses into a bottom sheet or hamburger menu, and tables transition to stacked card views.

## Elevation & Depth
Elevation is handled through **Tonal Layers** and **Low-Contrast Outlines** rather than heavy shadows. This maintains the "flat" technical aesthetic. 

- **Level 0 (Surface):** Neutral-50 (#F8FAFC) for the application background.
- **Level 1 (Cards/Containers):** Pure White (#FFFFFF) with a 1px border (#E2E8F0).
- **Level 2 (Popovers/Modals):** Pure White with a tight, 4px blur, 10% opacity shadow to provide subtle separation without breaking the grid-like feel.
- **Active State:** A 2px primary-colored left border is used to denote active sidebar items or selected table rows.

## Shapes
The design system uses a **Soft (Level 1)** roundedness profile. This 4px (0.25rem) radius is applied to buttons, input fields, and cards. It provides a modern touch while maintaining the structural, "boxy" feel expected of a technical tool. Status badges and tags use a slightly higher radius (8px) to distinguish them as discrete interactive or semantic chips.

## Components
### Buttons & Inputs
Buttons use a solid fill for primary actions and a "ghost" (outline) style for secondary actions. Input fields use a fixed-height monospaced font for translation key entry.

### Data Tables
The centerpiece of the system. Tables must include:
- **Sticky Headers:** Always visible during scroll.
- **Hover States:** Subtle background shift (`slate-50`) to track rows.
- **Status Badges:** Small, high-contrast pills (e.g., Emerald background with Dark Emerald text) for "Used", "Missing", and "Dynamic".

### KPI Cards
Located at the top of results pages, these cards display high-level metrics (e.g., "Total Keys", "Coverage %"). They feature a 1px border, no shadow, and a large display-lg number.

### Sidebar Navigation
A vertical list using `Inter` Medium. Icons should be 20px, stroke-based (2px thickness), using the Primary Indigo color only when the item is active.

### Code Snippets
Inline code uses a light gray background (`slate-100`) and the monospaced font. Block code uses a `slate-900` background with syntax highlighting for better context.
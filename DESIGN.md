# DESIGN.md — MonkeyPatch UI/UX Design Philosophy & System

## Objective

Refine the MonkeyPatch Chrome extension UI to improve readability, visual hierarchy, consistency, and usability while preserving its playful banana/monkey/brain identity.

The goal is a systematic UI refinement that makes the interface easier to read, faster to scan, and more pleasant to use.

**Guiding Principle:**
> **Use amber to establish the environment, raspberry to invite action, typography to establish importance, and whitespace to create clarity.**

---

## 1. Design Direction

Aim for a modern productivity application with a playful personality:
- Warm, dark surfaces rather than neutral charcoal or pure black.
- Amber, gold, and brown as the primary visual language.
- Raspberry pink reserved primarily for actions and interactive emphasis.
- Large, comfortable typography (`13px` minimum, `15–16px` primary content, `17–18px` section headings, `20–22px` application title).
- Clear hierarchy through spacing, typography, and subtle surface variations.
- Rounded corners and restrained borders.
- Personality comes from the palette, branding, and small details—usability comes first.

---

## 2. Color Philosophy

Foundation ColorRamp: `https://www.colorramp.com/?crisp-amber=%23FACC15&bold-raspberry=%23DB2777`

### Amber: Structure and Identity
The amber ramp dominates the interface. Darker shades form backgrounds, panels, containers, and selected navigation states; lighter shades provide text, icons, highlights, and brand identity.

| Role | Hex | Usage |
|---|---|---|
| **Main Background** | `#0B0700` | Root canvas background |
| **Elevated Surface** | `#1B1203` / `#271800` | Primary cards, panels, inactive tabs |
| **Inset Surface** | `#120B00` | Text inputs, code blocks, nested items |
| **Secondary Surface** | `#423406` | Active filter cards, secondary badges, hover fills |
| **Subtle Borders** | `#5B4B1E` | Restrained container and control borders (`rgba(91, 75, 30, 0.55)`) |
| **Muted Text** | `#CBA61F` | Secondary metadata, timestamps, domains |
| **Brand Accent** | `#FACC15` | Logo title, section icons, active highlights |
| **Soft Highlight** | `#FFE04B` | Active navigation tab surface, highlighted labels |
| **Primary Text** | `#FFFAE9` | Section headings, card titles, primary body text |
| **Secondary Text** | `#E6DEC8` | Previews, descriptions, supporting copy |

### Raspberry: Actions and Interaction
Raspberry is used deliberately for actions (`Save`, `Add`, `Apply`, primary toggles) rather than decoratively on every heading or navigation tab.

| Role | Hex | Usage |
|---|---|---|
| **Primary Action** | `#DB2777` | Primary CTA buttons (`+ Save`, `Apply`, active toggle switches) |
| **Primary Action Hover** | `#F76F9F` | Hover state and accent highlights |
| **Subtle Action Background** | `#3B0018` | Secondary/destructive action pill background |
| **Action Border** | `#AD175C` | Border for subtle raspberry action buttons |
| **Action Text on Dark** | `#FFA9C8` | Label text inside subtle raspberry buttons (`Clear All`, `Manage Rules`) |

### Semantic Colors
- **Success / Connected (`#22C55E`):** Compact green status dot and subtle green border (`rgba(34, 197, 94, 0.35)`) for `API Connected` and healthy states.
- **Warning (`#FACC15`):** Amber for caution or update banners.
- **Destructive / Error (`#F43F5E`):** Destructive confirmations and error alerts.

---

## 3. Typography and Readability

Readability is a first-class design constraint:

| Element | Size | Weight / Color |
|---|---|---|
| **Application Title** | `20–22px` | `800`, Crisp Amber `#FACC15` |
| **Section Heading** | `17–18px` | `700`, Warm Off-White `#FFFAE9` (normal case, not all-caps) |
| **Primary Content** | `15–16px` | `400–600`, `#FFFAE9`, line-height `1.45` |
| **Buttons and Tabs** | `14–16px` | `600–700`, `40–42px` minimum interactive target height |
| **Secondary Information** | `14px` | `400–500`, `#E6DEC8` |
| **Timestamps & Tertiary Metadata** | `13px` min | `400–500`, `#CBA61F` |

---

## 4. Navigation vs. Actions & Layout Spacing

1. **Navigation:** Uses warm amber/brown surfaces. The active top tab uses a warm gold fill (`#FFE04B` / `#FACC15`) with dark espresso text (`#1A1102`) and a subtle bottom indicator—distinct from raspberry action buttons.
2. **Actions:** Primary creation/mutation actions use `#DB2777` raspberry fills; secondary management actions use `#3B0018` subtle fills with `#AD175C` borders or warm `#271800` surfaces.
3. **Spacing & Progressive Disclosure:**
   - Consistent `4, 8, 12, 16, 20, 24px` spacing scale.
   - Flat top-level sections separated by subtle horizontal rules (`<hr />`) to maximize horizontal space in the Side Panel.
   - Secondary item actions (`Delete`, `Copy`, advanced details) live in `•••` contextual menus or expandable sections to keep list rows clean and scannable.

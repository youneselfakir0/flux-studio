---
name: Flux Studio
description: Asset-first creative studio for ComfyUI power-users.
colors:
  primary: "#7c5cff"
  primary-strong: "#603ce2"
  accent: "#00f0ff"
  tertiary: "#10b981"
  bg: "#0b0d10"
  surface: "#13161c"
  surface-2: "#1a1e27"
  surface-3: "#222733"
  text: "#e2e2e6"
  text-dim: "#c9c4d8"
  muted: "#8b8794"
  faint: "#5d5a67"
  outline: "#938ea1"
  outline-variant: "#484555"
rounded:
  sm: "8px"
  md: "10px"
  lg: "14px"
  xl: "18px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.full}"
    padding: "8px 14px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-dim}"
    rounded: "{rounded.full}"
    padding: "8px 14px"
---

# Design System: Flux Studio

## Overview

**Creative North Star: "The Asset-First Studio"**

Flux Studio is designed as a high-precision control center for ComfyUI. Unlike native interfaces that focus on the graph, Flux Studio centers the experience around the assets—Models, LoRAs, and Prompts. It operates as a "Surgical Layer," providing a streamlined "App Mode" for rapid iteration while allowing an instant dive into the "Nodal Editor" for technical perfection.

The aesthetic is "Dark Studio Pro": a deep, obsidian-based palette with high-energy electric accents (Violet and Cyan) that highlight active states and critical controls without overwhelming the imagery.

**Key Characteristics:**
- **Asset-Centric:** Assets are the primary entry point, not the graph.
- **Surgical Depth:** Instant transition from simple to advanced modes.
- **VRAM-Aware:** UI reflects the hardware constraints of the local GPU.
- **NSFW-Governance:** Integrated, transparent labeling and filtering for specialized content.

## Colors

The palette uses a deep obsidian base with luminous accents to create a professional, focused environment.

### Primary
- **Electric Violet** (#7c5cff): The main action color. Used for primary buttons, active nav items, and focal highlights.
- **Deep Violet** (#603ce2): Used for hover states and strong emphasis.

### Accents
- **Neon Cyan** (#00f0ff): Secondary accent for specialized controls and a sense of "technical" precision.
- **Emerald Green** (#10b981): Used for success states, safety labels, and positive indicators.

### Neutral
- **Obsidian BG** (#0b0d10): The root background.
- **Surface** (#13161c): Main container and panel backgrounds.
- **Surface-Deep** (#1a1e27 / #222733): Layered depth for rails and nested panels.
- **Text** (#e2e2e6): High-contrast primary text.
- **Text-Dim** (#c9c4d8): Secondary labels and metadata.
- **Muted/Faint** (#8b8794 / #5d5a67): Disabled or low-priority hints.

### NSFW Labels
- **None** (#10b981): Safe content.
- **Soft** (#f59e0b): Mildly explicit.
- **Mature** (#f97316): Explicit.
- **X** (#e11d48): Hardcore.

## Typography

The system pairs a geometric display font with a highly readable sans-serif for the "Studio" feel.

**Display Font:** Space Grotesk (fallback: Inter, sans-serif)
**Body Font:** Inter (fallback: system-ui, sans-serif)
**Label/Mono Font:** JetBrains Mono (fallback: monospace)

**Character:** Technical, precise, and modern. High legibility for complex metadata.

### Hierarchy
- **Display** (600, 23px, 1.2): used for view headers and primary section titles.
- **Headline** (600, 15px, 1.3): used for brand identity and sub-headers.
- **Body** (400, 14px, 1.5): the standard reading size for prompts and descriptions.
- **Label** (500, 11px, 1.4, uppercase): used for rail labels, metadata keys, and badge text.

## Layout

The layout follows a **Hub-and-Spoke** topology. The center is the "Active View" (App Mode or Editor), flanked by functional rails.

- **Left Rail (Asset Hub):** Fixed width (320px). Contains the Navigation, Base Model filters, and Tag cloud.
- **Main View:** Fluid width. Holds the current active surface.
- **Right Rail (Context Hub):** Fixed width (280px). Used for History, Queue, and specific asset details.
- **Top Bar:** Fixed height (62px). Contains the global search, View switcher, and Safety toggle.

## Elevation & Depth

The system uses **Tonal Layering** and subtle glow effects rather than heavy shadows to convey depth.

- **Layering:** BG $\rightarrow$ Surface $\rightarrow$ Surface-2 $\rightarrow$ Surface-3.
- **The Glow Rule.** Shadows are minimized; instead, active elements use a subtle violet glow (`--glow`) to feel "powered on."

## Shapes

The form language is **Soft-Technical**.

- **Corners:** Large radius for main containers (14px), medium for controls (10px), and full-round (999px) for buttons and chips.
- **Borders:** Thin, low-contrast lines (`--line`) define boundaries without adding visual noise.

## Components

### Buttons
- **Shape:** Full-round (pill).
- **Primary:** Electric Violet background, white text. Uses a soft inner glow to feel tactile.
- **Ghost:** Transparent background, muted border. Transitions to surface-2 on hover.

### Cards (Gallery)
- **Corner Style:** 14px radius.
- **Background:** Surface color with a thin border.
- **Interaction:** Lift-on-hover with a subtle Y-axis shift and increased shadow.

### Inputs / Fields
- **Style:** Surface-2 background, thin border, rounded-md.
- **Focus:** Violet border shift with a soft outer glow.

### Badges (NSFW)
- **Style:** Small, uppercase, mono font.
- **Treatment:** Uses a luminescent dot indicator (glow) corresponding to the NSFW level.

## Do's and Don'ts

### Do:
- **Do** prioritize the asset over the graph. A user should be able to generate an image without ever seeing a node.
- **Do** use the "Surgical" transition. Moving from App to Nodal mode should feel like zooming into the details, not switching pages.
- **Do** maintain the "Dark Studio" contrast. Keep backgrounds deep and accents luminous.

### Don't:
- **Don't** use generic Material Design defaults. Every interaction should feel tailored to a high-end creative tool.
- **Don't** overload the screen with technical metadata. Hide "Tensors" and "Weights" behind advanced toggles.
- **Don't** allow the UI to block the image. The imagery is the product; the interface is the frame.

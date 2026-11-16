# Information sensitivity palette research

Researched 2 November 2026. Scope: precedents for five enterprise sensitivity levels where every level remains unclassified. The official schemes below are evidence about color use, not classification equivalences or a requirement to adopt their terminology.

## Primary-source cases

### New Zealand Protective Security Requirements

The official marking table uses black (`#000000`) for IN-CONFIDENCE, SENSITIVE and RESTRICTED; green (`#00B050`) for CONFIDENTIAL; blue (`#0000FF`) for SECRET; and red (`#FF0000`) for TOP SECRET. It does not assign a color to UNCLASSIFIED in that table. This demonstrates that distinct levels need not have distinct colors, and that green does not universally mean public or low sensitivity. Its classified categories are unsuitable as direct names for the proposed unclassified enterprise model.

Source: [How to protectively mark information and equipment](https://www.protectivesecurity.govt.nz/classification/protectively-marking-information-and-equipment).

### Australian protective marking practice

South Australia's official framework specifies blue RGB 79/129/189 (`#4F81BD`) for PROTECTED, salmon RGB 229/184/183 (`#E5B8B7`) for SECRET, and red RGB 255/0/0 (`#FF0000`) for TOP SECRET when text-based markings cannot be used. It recommends yellow for OFFICIAL: Sensitive if color is needed. Tasmania's current official information security policy supplies RGB 255/242/204 (`#FFF2CC`) for that yellow. These government sources establish a genuine yellow/blue/salmon/red precedent, but not five unclassified enterprise tiers.

Sources: [South Australian Protective Security Framework: Protecting official information](https://security.sa.gov.au/__data/assets/pdf_file/0011/1057277/SAPSF-INFOSEC1-Protecting-official-information.pdf), [Tasmania INFOSEC-2, December 2025](https://www.security.tas.gov.au/resources/policies/INFOSEC-2-Version-2.1-December-2025.pdf).

### United States standard security cover sheets and labels

The IRS's official security manual identifies orange for Top Secret (SF 703), red for Secret (SF 704), and blue for Confidential (SF 705). A US Navy first-party security briefing also identifies green for Unclassified (SF 710) and purple for Classified (SF 709). Crucially, purple is not a tier above orange: it identifies classified material whose specific level is pending. These sources do not establish web hex values. Any hex values selected for an enterprise interface would be design adaptations.

Sources: [IRS Manual 10.9.1](https://www.irs.gov/irm/part10/irm_10-009-001), [NAVSEA security onboarding briefing](https://www.navsea.navy.mil/Portals/103/Documents/NSWC_Carderock/Day2_Employee_Onboarding_Presentation_V29NOV2021.pdf), [National Archives standard forms](https://www.archives.gov/isoo/security-forms).

## Implications for the enterprise proposal

- A palette of gray / yellow / blue / salmon / red is an Australian-inspired five-step adaptation, with the gray added by the enterprise. It is not an official five-level unclassified standard.
- Green / blue / yellow / red / purple is a reasonable bespoke enterprise palette, but purple as the highest level is a local convention, not supported by the US purple label's meaning.
- Five distinct colors are a usability choice. Always accompany each color with a number and written sensitivity label; retain information type and sharing audience as separate metadata.
- Government marking colors can conflict across countries, so describing any of these palettes as a universal NATO palette would be inaccurate.

### FIRST Traffic Light Protocol 2.0

TLP defines sharing boundaries rather than a formal classification hierarchy. The official labels are CLEAR, GREEN, AMBER and RED, with AMBER+STRICT restricting AMBER sharing to the recipient organization. AMBER and AMBER+STRICT have the same color, so this yields five written sharing designations, not five distinct colors. Exact font colors on black are CLEAR `#FFFFFF`, GREEN `#33FF00`, AMBER `#FFC000`, RED `#FF2B2B`.

Source: [FIRST TLP 2.0](https://www.first.org/tlp/).

For the present enterprise model, gray / blue / yellow / orange / red could be a custom five-color palette informed by TLP's escalation of sharing restrictions. Gray / blue / yellow / red / purple is another custom option. Neither palette is official TLP, and purple has no TLP rank. Preserve the five enterprise level names rather than applying TLP labels to different sharing rules.

## Human perception evidence and revised application

### Empirical warning-color findings

Smith-Jackson and Wogalter (2000) asked English-speaking monolingual participants to rate ten ANSI colors for perceived hazard. Red rated highest, followed by yellow, black and orange. This supports red as a strong hazard cue in the studied warning context. It does not establish a universal yellow-below-orange scale, demonstrate behavior change, or validate enterprise confidentiality badges. The paper's abstract also reports broad similarities to an earlier Spanish-language study.

Source: [Users' Hazard Perceptions of Warning Components](https://journals.sagepub.com/doi/10.1177/154193120004403215).

### Cross-cultural associations

Jonauskaite et al. (2020) studied 4,598 participants in 30 nations and 22 native languages, matching 20 emotion concepts to 12 color terms. They found strong shared patterns alongside differences associated with nation, language and geography. This is evidence about associations with color terms, not proof that a specific interface color has a universal meaning or that people will correctly rank our five colors.

Source: [Universal Patterns in Color-Emotion Associations Are Further Shaped by Linguistic and Geographic Proximity](https://doi.org/10.1177/0956797620948810).

### Ordered quantitative displays

Crameri, Shephard and Heron (2020) explain how uneven gradients and rainbow-like palettes distort scientific data. Perceptually ordered palettes with even, monotonic lightness help preserve ordering and grayscale readability. This evidence concerns quantitative color maps; it does not require all discrete interface badges to share one hue. Application inference: keep distinct, labelled colors for badges, but use a suitable sequential palette with a legend when displaying sensitivity as an ordered heatmap. Do not assume the five badge colors have perceptually equal steps.

Source: [The misuse of colour in science communication](https://doi.org/10.1038/s41467-020-19160-7).

### Accessibility requirements

WCAG 2.2 SC 1.4.1 requires a visible cue beyond color when color conveys meaning. SC 1.4.3 requires at least 4.5:1 contrast for normal text, or 3:1 for qualifying large text. These are accessibility criteria, separate from the empirical association studies. Application: always display level number and full label, and test each foreground/background pair. A readable yellow badge normally uses dark text on a pale yellow background rather than yellow text on white.

Sources: [W3C Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html), [W3C Contrast Minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

### Revised design recommendation

For the five unclassified enterprise badge levels, use gray / blue / yellow / orange / red from Public through Critical Sensitivity. Red at the highest level is better grounded in warning-color evidence than placing purple above red. The yellow/orange ordering remains a taught design convention rather than a universal perceptual hierarchy. Use numbers and labels to establish order. This exact palette has not been experimentally validated for this enterprise task; user testing should check ordering, recognition, and handling decisions with representative users. Purple can remain an optional branding choice, but cannot be justified as inherently more restrictive than red by the evidence reviewed here.

Proposed badge pairs (foreground / background), with WCAG contrast ratios calculated by the supervising agent:

| Level | Label | Foreground | Background | Contrast |
|---|---|---|---|---|
| 1 | Public | #475569 | #F1F5F9 | 6.92:1 |
| 2 | Internal | #1D4ED8 | #EFF6FF | 6.16:1 |
| 3 | Sensitive | #854D0E | #FEF9C3 | 6.38:1 |
| 4 | Highly Sensitive | #9A3412 | #FFEDD5 | 6.38:1 |
| 5 | Critical Sensitivity | #991B1B | #FEE2E2 | 6.80:1 |

Each specified text pair exceeds the 4.5:1 normal-text threshold. This calculation does not validate the whole interface, separation between levels, or performance under every color-vision condition. Gray Public is a neutral design choice that avoids adding a green success/validation cue; that implication is a design rationale, not a tested finding in the studies above.

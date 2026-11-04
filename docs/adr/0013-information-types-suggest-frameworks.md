---
status: accepted
amends: 0012-information-types-set-a-floor-for-the-sensitivity-level.md
---

# Information Types suggest Frameworks

ADR 0012 gave an Information Type only a Sensitivity Level and left open whether a type could bring in Frameworks (personal data, so GDPR). It can, as a **suggestion**: the Compliance Manager (or an Admin) picks, for each type, the Frameworks it suggests, and a System that declares the type is offered each Published, non-base one for its Framework Scope. Nothing enters a Framework Scope by itself. The System's owner (or an Admin) confirms a suggestion in the onboarding interview and on the Profile tab, or leaves it out. Scope stays the owner's call, as the onboarding question of #258 already makes it: both need an explicit Yes.

A suggestion is **open** while the Framework is not in the System's Framework Scope and the owner has not left it out. A System with an open suggestion is flagged **Suggested Frameworks to review**, for its owner, in the same way a System under a raised level is flagged "below its Information Types" (ADR 0012). The flag never blocks a submit, and a curator linking or unlinking a Framework on a type writes nothing to any System: the flag comes from the rule, so Systems that declare the type are flagged the moment the curator saves.

Leaving a suggestion out is recorded, per System, per Information Type and per Framework. The owner may also remove a suggested Framework from the scope later; that records the same decision, so the System is not flagged again for what the owner just removed. The decision is about the type the owner was shown: a type a curator links later, or a second declared type that suggests the same Framework, opens the suggestion again. A decision goes away with the System, the type or the Framework. A type the System no longer declares suggests nothing, and a decision recorded for it is kept and applies again if the System declares the type again.

An Onboarded System that takes on a suggested Framework gets no Framework review. Continuous Compliance brings in the new Controls (ADR 0006), and the standalone Framework review stays future work, as ADR 0010 says. Leaving a suggestion out is not a Change Event, since it changes nothing about the System's Controls; adding the Framework to the scope keeps its existing `CLASSIFICATION_CHANGED` event.

The onboarding interview skips a Framework's own onboarding question (#258) when a declared Information Type already suggests that Framework, and asks the suggestion in its place as a Yes/No ("Customer personal data usually falls under GDPR. Put GDPR in scope?"). Yes puts the Framework in the new System's scope; No records the decision when the System is created, in the same transaction; unanswered leaves the suggestion open and the System is created flagged. The server checks each declined Framework against what the declared types really suggest and refuses the request otherwise.

A Draft Framework can be linked to a type, since a curator may prepare the link before publishing; it suggests nothing until Published. The base Framework is refused: it is always in scope.

## Considered options

- **Add the suggested Frameworks to the scope automatically**: rejected, because Framework Scope drives which Controls apply (ADR 0007) and declaring a type would silently change them. It would also make the type, not the owner, decide the scope.
- **Record no decision and show a permanent note on the System instead**: not chosen. The note would stay for every System that deliberately keeps a Framework out, so the flag would never clear. The product owner chose to record the decision (#300).
- **Flag by writing a marker on each affected System when a curator changes a type**: rejected. The flag is derived from the rule, so there is nothing to keep in step and nothing to write to Systems the curator does not own.
- **A Framework review for an Onboarded System that takes on a suggested Framework**: out of scope, see above.

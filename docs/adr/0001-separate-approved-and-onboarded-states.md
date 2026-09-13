---
status: accepted
---

# Separate `APPROVED` and `ONBOARDED` onboarding states

A System's onboarding decision (a reviewer's Approval) and its actual technical integration/cutover often happen at different times — approval is a point-in-time judgment call, while onboarding is a later, separate real-world event. We modeled `APPROVED` and `ONBOARDED` as distinct `OnboardingStatus` values with independent triggers (`APPROVED` set by an Approval decision; `ONBOARDED` set later by the System Owner or an Admin, recorded via a dedicated `onboardedAt` timestamp) rather than collapsing them into one state, so that "when was this cleared" and "when did this actually go live" remain separately queryable instead of being conflated or lost to an unrelated `updatedAt` change.

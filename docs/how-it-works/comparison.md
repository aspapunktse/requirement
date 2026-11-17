# How a Comparison works

> **Status: designed; the data model and API are built (#372), the pages are not.** This describes the behaviour agreed with the product owner on 2026-11-16. It is the source for the user manual. The terms are defined in [`CONTEXT.md`](../../CONTEXT.md) under "Evaluation"; the one architectural decision is [ADR 0015](../adr/0015-not-selected-closes-a-system-and-can-be-reopened.md).

## What it is for

You have a need (say, a new HR system) and several products that could meet it. A **Comparison** sets those products side by side and shows how well each one meets the first set of requirements, so that you can see which one scores highest before you choose.

Each product is a **Candidate**. A Candidate is an ordinary System in the app. You answer its first-round questions once, and if it is chosen it carries on through evaluation with those answers in place.

## Before you start

- **Staged evaluation must be on.** An Admin switches on "Staged evaluation for new Systems" in Settings. Only a staged System has a first round, so only a staged System can be a Candidate.
- **First-round Controls must be marked.** A Framework Owner marks which Controls of their Framework are first round. A Candidate with no first-round Controls has nothing to score, and its score shows as "—".
- **You need a role that may create a System**: System Owner, Risk Owner or Admin.

## The steps

### 1. Create the Comparison

Open **Comparisons** and choose **New Comparison**. Give it a name ("New HR system 2027") and describe the need it answers. You become its owner.

### 2. Add Candidates

A Comparison holds two to five Candidates. Add them in any of three ways:

- **An existing System.** Choose **Add Candidate** on the Comparison and pick a System. Or select Systems in the Systems list and choose **Add to Comparison**.
- **A new System.** Choose **Add Candidate → Create a new System**. The normal onboarding interview runs, and the new System joins the Comparison when it is created.
- **A new System like one you already have.** When the Comparison already has a Candidate, the interview offers **Start from <Candidate>'s classification**. It fills in Deployment Facets, Information Types, Sensitivity Level, Impact Levels and Framework Scope. You can change any of them before you create the System.

A System can be added when it is staged and not closed, at any stage of its evaluation. The same System can be a Candidate in more than one Comparison.

### 3. Answer the first round for each Candidate

Each Candidate's owner answers its first-round Controls on the System's own page, as for any System. Nothing is answered in the Comparison itself. The Comparison shows the result as it stands, so scores move as answers come in.

### 4. Read the Comparison

For each Candidate the Comparison shows:

| Figure | What it means |
| --- | --- |
| **Comparison Score** | The share of the Candidate's first-round Controls that are fulfilled. See "How the score is worked out". |
| **Answered** | How many first-round Controls have an answer. A Candidate with unanswered Controls is marked **incomplete**. |
| **Mandatory not fulfilled** | First-round Controls that are mandatory and not fulfilled. A high score can hide one of these. |
| **Open Risks** | The Candidate's open Risks, by severity. |
| **Classification** | Deployment Facets, Sensitivity Level, Impact Levels and Framework Scope. |

Candidates are listed with complete ones first, highest score first, and incomplete ones after, also by score.

Below the summary, a **Control-by-Control table** has one row per first-round Control and one column per Candidate, showing each Candidate's status for that Control. A Control that does not apply to a Candidate reads **Does not apply**.

**When Candidates differ.** A SaaS Candidate and an on-premises one get different Controls, so their scores rest on different sets. The Comparison allows this, because different deployment models are often the real choice. It shows a notice naming what differs (Deployment Facets, Sensitivity Level, Impact Levels or Framework Scope), and the Control-by-Control table shows where.

### 5. Record the outcome

When you have decided, the Comparison's owner or an Admin chooses **Record outcome** and picks either one Candidate or **None chosen**, with a comment saying why. The comment is required. The app never picks for you: price, fit and contract terms are outside it, and the chosen Candidate does not have to be the top scorer.

Recording the outcome:

- closes the Comparison, which becomes read-only;
- freezes each Candidate's score and counts as they were at that moment, shown with the date;
- writes an entry in each Candidate's history.

### 6. Deal with the Candidates not chosen

When you record the outcome, the app offers to close each Candidate that was not chosen as **Not selected**. You decide per Candidate; nothing is closed automatically.

- A Not selected System is read-only for everyone and kept for the record.
- It leaves the Draft counts and its owner's tasks.
- Only a Candidate still in evaluation can be closed this way, never one that is authorized to operate or Onboarded.
- The Comparison's owner can close the Candidates they own. An Admin can close any.
- An Admin can **reopen** a Not selected System, with a comment. It returns to the stage it was in, with its answers intact. Use this when the first choice falls through.

A Candidate you leave open stays an ordinary System.

## How the score is worked out

**Comparison Score = fulfilled first-round Controls ÷ first-round Controls that count**, as a percentage.

- **First-round Controls** are the Controls that apply to the Candidate and are marked first round by the owner of a Framework in its Framework Scope.
- **Fulfilled** means effectively Fulfilled. A Control the Candidate inherits from the Organization or from a Provider counts.
- **Not Applicable** Controls are left out. They count neither for nor against.
- **Waived** Controls count as not fulfilled. A waiver is an accepted shortfall, and it should not lift a Candidate above one that really fulfils the Control.
- **In Progress** and **unanswered** Controls count as not fulfilled.
- Every Control weighs the same.
- When no first-round Control counts, the score is "—".

**Example.** A Candidate has 14 first-round Controls. One is Not Applicable, so 13 count. Nine are Fulfilled, one is Waived, one is In Progress and two are unanswered. The score is 9 ÷ 13 = 69%, marked "incomplete: 12 of 14 answered".

The Comparison Score is not the Compliance Percentage. The Compliance Percentage is per Framework and counts Requirements; the Comparison Score counts first-round Controls across all the Candidate's Frameworks.

## Who can do what

| Action | Who |
| --- | --- |
| Create a Comparison | System Owner, Risk Owner, Admin |
| Rename it, edit the need | Its owner, an Admin |
| Name participants | Its owner, an Admin |
| Add a Candidate | Its owner (a System they can see), a participant (a System they own), an Admin (any System) |
| Remove a Candidate | Its owner, an Admin, and the System's owner for their own System, while the Comparison is open |
| Record the outcome, reopen | Its owner, an Admin |
| Delete an open Comparison | Its owner, an Admin. The Systems are untouched. A closed Comparison can't be deleted. |
| Change the Comparison's owner | An Admin |
| Close a Candidate as Not selected | The Comparison's owner for Candidates they own, an Admin for any |
| Reopen a Not selected System | An Admin |

Adding a System to a Comparison gives nobody new rights to change it.

## Who sees what

A System Owner normally sees only the Systems they own. A Comparison often has Candidates with different owners, so it shows a limited summary of every Candidate to everyone who can see the Comparison.

**Who can see a Comparison:** its owner, its participants, the owner and the Business System Owner of each Candidate, and the roles that see every System (Admin, Risk Owner, Reviewer, Compliance Manager, Internal Auditor, Risk Facilitator).

**Participants.** The Comparison's owner (or an Admin) can name other people as participants. A participant sees the Comparison and can add Systems they own as Candidates. This is how three owners who evaluate one product each bring their Systems into one Comparison.

**What they learn about a Candidate they can't open:** its name, vendor, owner, classification, Comparison Score, counts, and its status for each first-round Control. They do not see its evidence, notes or Risk details, and its name does not link to its System page.

## What a Comparison does not do

- It does not affect evaluation. No gate, verdict or submission waits for it.
- It does not choose. The score informs the choice.
- It has no weights per Control, and no export or print, in the first version.

## Where it shows up elsewhere

- **A Candidate's System page** shows "Candidate in Comparison <name>" with a link. OG1 participants and the Business System Owner can open it from there.
- **A Candidate's history** has an entry when it is added to or removed from a Comparison, when an outcome is recorded, and when it is closed as Not selected or reopened.
- **The Systems list** has Not selected as a lifecycle status of its own.

## Special cases

- **A Candidate is rejected at a gate while the Comparison is open.** It stays in the Comparison, shown as Rejected, and can't be chosen.
- **A closed Comparison is reopened.** The outcome is cleared and the figures are live again. Systems closed as Not selected stay closed until an Admin reopens them.
- **Staged evaluation is switched off later.** Existing Comparisons keep working. New Systems created while it is off can't be added.
- **Fewer than two Candidates.** A Comparison can be saved with fewer, but an outcome can only be recorded when it has at least two.

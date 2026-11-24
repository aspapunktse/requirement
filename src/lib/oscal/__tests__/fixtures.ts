/** Small hand-written OSCAL v1.2.3 package for the validator tests. Each call returns a fresh copy. */
const UUID = {
  catalog: "11111111-1111-4111-8111-111111111111",
  profile: "22222222-2222-4222-8222-222222222222",
  ssp: "33333333-3333-4333-8333-333333333333",
  party: "44444444-4444-4444-8444-444444444444",
  thisSystem: "55555555-5555-4555-8555-555555555555",
  provider: "66666666-6666-4666-8666-666666666666",
  infoType: "77777777-7777-4777-8777-777777777777",
  user: "88888888-8888-4888-8888-888888888888",
  req1: "99999999-9999-4999-8999-999999999991",
  req2: "99999999-9999-4999-8999-999999999992",
  req3: "99999999-9999-4999-8999-999999999993",
  byc1: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  byc2: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
  byc3: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
  ghost: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
};
export { UUID as FIXTURE_UUID };

const meta = (title: string) => ({
  title,
  "last-modified": "2026-11-23T20:00:00Z",
  version: "1",
  "oscal-version": "1.2.3",
});

export function goodCatalog() {
  return {
    catalog: {
      uuid: UUID.catalog,
      metadata: meta("Test Control Library"),
      groups: [
        {
          id: "A.5",
          title: "Organizational controls",
          controls: [
            {
              id: "A.5.15",
              title: "Access control",
              controls: [{ id: "A.5.15.e1", title: "Access control enhancement" }],
            },
          ],
        },
        {
          id: "A.6",
          title: "Group of groups",
          groups: [{ id: "A.6.sub", title: "Nested group", controls: [{ id: "A.5.30", title: "Continuity" }] }],
        },
      ],
      controls: [
        { id: "A.8.5", title: "Secure authentication" },
        { id: "SEC-001", title: "Supplementary control" },
        { id: "A.7.8", title: "Not selected by the Profile" },
      ],
    },
  };
}

export function goodProfile() {
  return {
    profile: {
      uuid: UUID.profile,
      metadata: meta("Test Profile"),
      imports: [
        {
          href: "catalog.json",
          "include-controls": [{ "with-ids": ["A.5.15", "A.5.15.e1", "A.5.30", "A.8.5", "SEC-001"] }],
        },
      ],
    },
  };
}

export function goodSsp() {
  return {
    "system-security-plan": {
      uuid: UUID.ssp,
      metadata: {
        ...meta("Test System Security Plan"),
        roles: [{ id: "system-owner", title: "System owner" }],
        parties: [{ uuid: UUID.party, type: "person", name: "Test Owner" }],
        "responsible-parties": [{ "role-id": "system-owner", "party-uuids": [UUID.party] }],
      },
      "import-profile": { href: "profile.json" },
      "system-characteristics": {
        "system-ids": [{ "identifier-type": "https://requirement.example/ns/oscal", id: UUID.thisSystem }],
        "system-name": "Test Payroll",
        description: "Payroll batch system (fixture).",
        "system-information": {
          "information-types": [
            {
              uuid: UUID.infoType,
              title: "Payroll",
              description: "Salary data.",
              "confidentiality-impact": { base: "fips-199-moderate" },
              "integrity-impact": { base: "fips-199-moderate" },
              "availability-impact": { base: "fips-199-low" },
            },
          ],
        },
        status: { state: "under-development" },
        "authorization-boundary": { description: "The payroll batch system and its Provider." },
        "responsible-parties": [{ "role-id": "system-owner", "party-uuids": [UUID.party] }],
      },
      "system-implementation": {
        users: [{ uuid: UUID.user, "role-ids": ["system-owner"] }],
        components: [
          {
            uuid: UUID.thisSystem,
            type: "this-system",
            title: "Test Payroll",
            description: "The System itself.",
            status: { state: "under-development" },
          },
          {
            uuid: UUID.provider,
            type: "service",
            title: "Test Directory",
            description: "A Provider.",
            status: { state: "operational" },
            "responsible-roles": [{ "role-id": "system-owner", "party-uuids": [UUID.party] }],
          },
        ],
      },
      "control-implementation": {
        description: "Controls selected by the Profile.",
        "implemented-requirements": [
          {
            uuid: UUID.req1,
            "control-id": "A.5.15",
            "by-components": [
              {
                "component-uuid": UUID.thisSystem,
                uuid: UUID.byc1,
                description: "Access is reviewed quarterly.",
                "implementation-status": { state: "implemented" },
              },
            ],
          },
          {
            uuid: UUID.req2,
            "control-id": "A.5.15.e1",
            "by-components": [
              {
                "component-uuid": UUID.provider,
                uuid: UUID.byc2,
                description: "The Provider enforces it.",
                "implementation-status": { state: "partial" },
              },
            ],
          },
          {
            uuid: UUID.req3,
            "control-id": "A.8.5",
            statements: [
              {
                "statement-id": "A.8.5_smt",
                uuid: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                "by-components": [
                  { "component-uuid": UUID.thisSystem, uuid: UUID.byc3, description: "SSO with MFA." },
                ],
              },
            ],
          },
        ],
      },
    },
  };
}

export const goodPackage = () => ({ catalog: goodCatalog(), profile: goodProfile(), ssp: goodSsp() });

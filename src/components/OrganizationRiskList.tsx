"use client";

import { useState } from "react";
import { RiskRow, type Risk } from "@/components/RiskList";

/**
 * The Risks that belong to no System (#157), opened by an Organization-level Nonconformity. A Risk
 * Owner or an Admin (`canManage`) changes a Risk's status, mitigation plan and owner; the Internal
 * Auditor only reads. The rows are loaded by the page and passed down; saving goes to
 * `PATCH /api/risks/[id]`.
 */
export function OrganizationRiskList({
  initialRisks,
  canManage,
  canOpenCheckUp,
  owners,
}: {
  initialRisks: Risk[];
  canManage: boolean;
  canOpenCheckUp: boolean;
  owners: { id: string; name: string }[];
}) {
  const [risks, setRisks] = useState<Risk[]>(initialRisks);

  if (risks.length === 0) {
    return <p className="text-sm text-zinc-500">No Organization Risks. An Organization-level Nonconformity opens one.</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {risks.map((risk) => (
        <RiskRow
          key={risk.id}
          risk={risk}
          patchUrl={`/api/risks/${risk.id}`}
          canManageStatus={canManage}
          canOpenCheckUp={canOpenCheckUp}
          owners={canManage ? owners : undefined}
          onUpdated={(updated) => setRisks((previous) => previous.map((r) => (r.id === updated.id ? updated : r)))}
        />
      ))}
    </ul>
  );
}

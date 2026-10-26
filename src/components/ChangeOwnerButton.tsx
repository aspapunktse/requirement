"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { ChangeOwnerDialog, type OwnerChangeSystem } from "@/components/ChangeOwnerDialog";

/** "Change owner" on the System page (#233), for the System's owner or an Admin; reloads the page when saved (or goes to the list when the System was handed away and may no longer be visible). */
export function ChangeOwnerButton({ system, actor }: { system: OwnerChangeSystem; actor: { id: string; role: string } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Change owner
      </Button>
      {open && (
        <ChangeOwnerDialog
          systems={[system]}
          actor={actor}
          onClose={() => setOpen(false)}
          onDone={(_result, handedAway) => {
            setOpen(false);
            // A non-Admin who gave the System away may no longer see it: its page would read "not found".
            if (handedAway) router.push("/systems");
            else router.refresh();
          }}
        />
      )}
    </>
  );
}

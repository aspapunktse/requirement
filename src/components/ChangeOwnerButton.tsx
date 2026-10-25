"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { ChangeOwnerDialog, type OwnerChangeSystem } from "@/components/ChangeOwnerDialog";

/** "Change owner" on the System page (#233), for the System's owner or an Admin; reloads the page when saved. */
export function ChangeOwnerButton({ system }: { system: OwnerChangeSystem }) {
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
          onClose={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

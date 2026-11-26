import Link from "next/link";
import { notFound } from "next/navigation";
import { getActingUser } from "@/lib/acting-user";
import { getVisibleSystem } from "@/lib/system-visibility";
import { prisma } from "@/lib/prisma";
import type { OscalReleaseManifest } from "@/lib/oscal/releases";
import { TRIGGER_LABEL } from "@/lib/oscal/release-labels";
import { formatDay } from "../../system-page-logic";
import "@/app/home/home.css";
import "../../system-cockpit.css";

/**
 * One stored OSCAL Release (#453), at `/systems/<id>/oscal-releases/<number>`: when and how it was made and by whom, the hash of
 * the zip, the manifest (each file in it and its SHA-256, and the evidence files by hash only) and a download of the stored bytes.
 * The same access as the list: an unknown or invisible System, or a number the System doesn't have, is not found (404). Stored
 * releases stay readable after the System closes.
 */
export default async function OscalReleasePage({ params }: PageProps<"/systems/[id]/oscal-releases/[number]">) {
  const { id, number: raw } = await params;
  const user = await getActingUser();
  if (!user) return <p className="p-6 text-rg-muted">Pick a user to act as first.</p>;

  const system = await getVisibleSystem(user, id);
  if (!system) notFound();
  const number = /^[1-9]\d{0,8}$/.test(raw) ? Number(raw) : null;
  if (number === null) notFound();
  const release = await prisma.oscalRelease.findUnique({
    where: { systemId_number: { systemId: id, number } },
    select: { number: true, trigger: true, createdAt: true, sha256: true, manifest: true, createdBy: { select: { name: true } }, internalAudit: { select: { id: true, title: true } } },
  });
  if (!release) notFound();
  const manifest = release.manifest as unknown as OscalReleaseManifest;

  return (
    <div className="hc">
      <p>
        <Link className="sc-link" href={`/systems/${id}`}>
          ← {system.name}
        </Link>
      </p>
      <section className="hc-card" aria-labelledby="rel-h">
        <div className="hc-card-h">
          <h1 id="rel-h">
            OSCAL Release {release.number} of {system.name}
          </h1>
          <a className="hc-btn" href={`/api/systems/${id}/oscal-releases/${release.number}`} download>
            Download release {release.number}
          </a>
        </div>
        <div className="hc-card-b">
          <dl className="sc-dl">
            <dt>Made</dt>
            <dd>{formatDay(release.createdAt.toISOString())}</dd>
            <dt>How</dt>
            <dd>
              {TRIGGER_LABEL[release.trigger]}
              {release.internalAudit && <> ({release.internalAudit.title})</>}
            </dd>
            <dt>By</dt>
            <dd>{release.createdBy?.name ?? "Unknown"}</dd>
            <dt>Version</dt>
            <dd>{release.number} (the version of each document in it)</dd>
            <dt>SHA-256 of the zip</dt>
            <dd>
              <code>{release.sha256}</code>
            </dd>
          </dl>
        </div>
      </section>

      <section className="hc-card" aria-labelledby="rel-files-h">
        <div className="hc-card-h">
          <h2 id="rel-files-h">Manifest</h2>
          <p>
            The SHA-256 of each file in the zip (also stored in the zip as <code>manifest.json</code>)
          </p>
        </div>
        <div className="hc-card-b sc-tablewrap">
          <table className="sc-rt">
            <thead>
              <tr>
                <th>File</th>
                <th>SHA-256</th>
              </tr>
            </thead>
            <tbody>
              {manifest.files.map((file) => (
                <tr key={file.name}>
                  <td>{file.name}</td>
                  <td>
                    <code>{file.sha256}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="hc-card" aria-labelledby="rel-evidence-h">
        <div className="hc-card-h">
          <h2 id="rel-evidence-h">Evidence files</h2>
          <p>Listed by hash only: the files themselves are not part of the release</p>
        </div>
        <div className="hc-card-b sc-tablewrap">
          {manifest.evidence.length === 0 ? (
            <p className="hc-empty">The package references no evidence files.</p>
          ) : (
            <table className="sc-rt">
              <thead>
                <tr>
                  <th>Evidence</th>
                  <th>File</th>
                  <th>SHA-256</th>
                </tr>
              </thead>
              <tbody>
                {manifest.evidence.map((item, index) => (
                  <tr key={`${index}-${item.sha256 ?? item.fileName}`}>
                    <td>{item.title}</td>
                    <td>{item.fileName}</td>
                    <td>{item.sha256 ? <code>{item.sha256}</code> : <span className="muted">No hash recorded</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}

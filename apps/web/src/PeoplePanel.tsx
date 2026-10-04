import { Camera, CameraOff, Mic, MicOff, UserPlus, Users } from "lucide-react";
import { Button } from "@studio/ui";
import type { Source } from "@studio/rendering";
import type { Command, StudioState } from "@studio/contracts";

export function PeoplePanel({
  sources,
  state,
  identity,
  host,
  inviting,
  invite,
  command,
}: {
  sources: Source[];
  state: StudioState;
  identity: string;
  host: boolean;
  inviting: boolean;
  invite: () => void;
  command: (value: Command) => Promise<void>;
}) {
  const guests = sources.filter((source) => source.identity !== "host");
  const renderPerson = (source: Source) => {
    const staged = state.participants.includes(source.identity);
    const camera = !!source.camera && !source.cameraMuted;
    const microphone = !!source.microphone && !source.microphone.isMuted;
    return (
      <li key={source.identity} className="joined-person">
        <span className="joined-avatar" aria-hidden="true">
          {source.name.charAt(0).toUpperCase()}
          <i />
        </span>
        <div className="joined-person-info">
          <strong title={source.name}>
            {source.name}
            {source.identity === identity ? " (you)" : ""}
          </strong>
          <span className={staged ? "joined-stage" : ""}>{staged ? "On stage" : "Backstage"}</span>
          <div className="joined-devices">
            <span
              title={camera ? "Camera on" : "Camera off"}
              aria-label={camera ? "Camera on" : "Camera off"}
            >
              {camera ? <Camera size={12} /> : <CameraOff size={12} />}
            </span>
            <span
              title={microphone ? "Microphone on" : "Microphone off"}
              aria-label={microphone ? "Microphone on" : "Microphone off"}
            >
              {microphone ? <Mic size={12} /> : <MicOff size={12} />}
            </span>
          </div>
        </div>
        {host && source.identity !== "host" && (
          <Button
            variant="secondary"
            size="sm"
            aria-label={`${staged ? "Remove" : "Add"} ${source.name} ${staged ? "from" : "to"} stage`}
            onClick={() =>
              void command({
                type: staged ? "stage.remove" : "stage.add",
                identity: source.identity,
              })
            }
          >
            {staged ? "Remove" : "Add to stage"}
          </Button>
        )}
      </li>
    );
  };
  const hostSource = sources.find((source) => source.identity === "host");
  return (
    <aside className="media-panel people-panel" aria-label="People in the studio">
      <div className="panel-header">
        <div>
          <Users size={17} />
          <strong>People</strong>
        </div>
        <span className="people-count">{sources.length} / 4</span>
      </div>
      <p className="panel-note">
        {host
          ? "Guests join backstage. Add them to the stage when they’re ready."
          : "The host controls who appears on stage. You can chat with everyone in Messages."}
      </p>
      {hostSource && (
        <section className="people-section">
          <h3>Host</h3>
          <ul className="joined-people">{renderPerson(hostSource)}</ul>
        </section>
      )}
      <section className="people-section">
        <h3>
          Joined guests <span>{guests.length} / 3</span>
        </h3>
        {guests.length ? (
          <ul className="joined-people">{guests.map(renderPerson)}</ul>
        ) : (
          <p className="people-empty">
            No guests have joined yet.
            {host
              ? " Share an invitation to bring them into the studio."
              : " Joined guests will appear here."}
          </p>
        )}
      </section>
      {host && (
        <Button variant="secondary" disabled={inviting || guests.length >= 3} onClick={invite}>
          <UserPlus size={16} />
          {inviting ? "Creating invite…" : "Invite guest"}
        </Button>
      )}
    </aside>
  );
}

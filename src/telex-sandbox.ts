import { convertTelex, TelexComposer, type TelexStepResult } from "./telex";

type TelexAction = { type: "key"; key: string } | { type: "backspace" };

declare global {
  // JavaScriptSandbox evaluates each expression in this shared isolate global.
  // eslint-disable-next-line no-var
  var convertV7TelexRaw: (raw: string) => string;
  // eslint-disable-next-line no-var
  var stepV7TelexKey: (key: string) => string;
  // eslint-disable-next-line no-var
  var stepV7TelexBackspace: () => string;
  // eslint-disable-next-line no-var
  var resetV7TelexSession: () => string;
  // eslint-disable-next-line no-var
  var replayV7TelexActions: (actionsJson: string) => string;
}

const session = new TelexComposer({
  mode: "standard",
  freeShapeMarks: true,
  spellCheck: true,
  autoRestoreNonVn: true,
});

function formatResult(result: TelexStepResult): string {
  return JSON.stringify(result);
}

globalThis.convertV7TelexRaw = (raw: string) =>
  convertTelex(raw, {
    mode: "standard",
    freeShapeMarks: true,
    spellCheck: true,
    autoRestoreNonVn: true,
  });

globalThis.stepV7TelexKey = (key: string) => formatResult(session.stepKey(key));

globalThis.stepV7TelexBackspace = () => formatResult(session.stepBackspace());

globalThis.resetV7TelexSession = () => {
  session.clear();
  return "";
};

globalThis.replayV7TelexActions = (actionsJson: string) => {
  session.clear();
  const actions = JSON.parse(actionsJson) as TelexAction[];
  let last: TelexStepResult = {
    committedWord: "",
    committedSuffix: "",
    preedit: "",
    terminated: false,
    handled: false,
  };
  for (const action of actions) {
    last =
      action.type === "backspace"
        ? session.stepBackspace()
        : session.stepKey(action.key);
  }
  return formatResult(last);
};

// Which copy of the farm wins at startup.
//
// There are up to three: what is on this device, what is on the server, and
// nothing at all. Picking between them is the single most dangerous decision
// this app makes, because the wrong answer does not throw — it silently
// replaces a day's work with an older copy and looks like a normal startup.
//
// That is not hypothetical. The first version of init() hydrated from the
// server and wrote the result straight over the local copy:
//
//     const { state } = await hydrate(farmId);
//     if (loaded) await saveState(loaded);
//
// with no check for whether the device was holding anything the server had not
// seen. A grower who spends the morning in a paddock with no signal, then
// drives back into range, would have every load they entered replaced by the
// server's older copy at the moment the app reopened. Nothing would be
// reported. The tickets would simply be gone.
//
// So the decision is pulled out here, as a pure function over four facts, for
// one reason: it can then be tested exhaustively without a browser, a server,
// or a login. tests/boot.test.mjs walks every combination.

/**
 * @param {object}  o
 * @param {string}  o.farmId       the farm being opened
 * @param {object?} o.localState   the farm saved on this device, if any
 * @param {string?} o.localFarm    which farm that saved copy belongs to.
 *                                 Null for copies written before stamping
 *                                 existed — unknown, not "mine".
 * @param {number}  o.pending      queued items the server has not accepted
 * @param {object?} o.serverState  what hydrate() returned, or null
 * @param {boolean} o.serverReachable  whether the server actually answered.
 *                                 Distinct from serverState being empty: a
 *                                 farm with no seasons is a real answer ("this
 *                                 account is new"), while no answer at all
 *                                 means we are simply offline. Conflating the
 *                                 two lets one farm's data be adopted into
 *                                 another's empty account.
 *
 * @returns {{use:'local'|'server'|'fresh', pushLocal:boolean,
 *            orphan:boolean, reason:string}}
 */
export function chooseBootState({
  farmId, localState = null, localFarm = null, pending = 0,
  serverState = null, serverReachable = serverState !== null,
}) {
  const hasLocal = !!localState;
  const hasServer = !!serverState && Object.keys(serverState.years || {}).length > 0;
  const localIsMine = hasLocal && localFarm === farmId;
  const localIsUnstamped = hasLocal && !localFarm;
  const localIsSomeoneElses = hasLocal && !!localFarm && localFarm !== farmId;

  // 1. Unsent work for this farm always wins. This is the rule the whole
  //    module exists for: the server cannot be more current than a change it
  //    has never received, however new the server's rows look.
  if (pending > 0 && localIsMine) {
    return {
      use: 'local', pushLocal: true, orphan: false,
      reason: 'this device is holding changes the server has not accepted yet',
    };
  }

  // 2. Unsent work belonging to a different farm. It must not be adopted — it
  //    would push one farm's records into another — and it must not be quietly
  //    overwritten either. Set aside and reported.
  if (pending > 0 && localIsSomeoneElses) {
    return {
      use: hasServer ? 'server' : 'fresh', pushLocal: false, orphan: true,
      reason: 'this device holds unsent changes for a different farm',
    };
  }

  // 3. Nothing owed locally: the server is the better copy where it has one.
  if (hasServer) {
    return {
      use: 'server', pushLocal: false, orphan: false,
      reason: 'the server has this farm and nothing is owed from this device',
    };
  }

  // 4. No server copy. Two quite different situations, and telling them apart
  //    matters:
  //
  //    - the server answered and this farm has no seasons: a genuinely new
  //      account. Whatever is on the device belongs to something else.
  //    - the server did not answer: we are offline, and the device is all
  //      there is.
  //
  //    A copy stamped with this farm is ours either way. An unstamped copy
  //    predates stamping and could belong to anyone, so it is used only when
  //    the server is unreachable — which keeps someone upgrading mid-season in
  //    a paddock working, without pouring an old farm into a new account.
  if (localIsMine || (localIsUnstamped && !serverReachable)) {
    return {
      use: 'local', pushLocal: pending > 0, orphan: false,
      reason: serverReachable
        ? 'the server has no seasons for this farm yet; the device copy stands'
        : 'the server could not be reached, using the copy on this device',
    };
  }

  // 5. A saved copy that belongs to another farm and owes nothing. Leave it
  //    alone and start clean; it is not ours to adopt or to delete.
  return {
    use: 'fresh', pushLocal: false, orphan: false,
    reason: hasLocal
      ? 'the saved copy belongs to a different farm, or to no farm we can name'
      : 'nothing saved on this device yet',
  };
}

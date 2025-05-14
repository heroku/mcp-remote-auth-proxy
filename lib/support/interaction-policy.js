import { interactionPolicy } from 'oidc-provider';

const policy = interactionPolicy.base();

// Do not show consent for this oauth proxy flow, since primary Identity already asks consent.
// https://github.com/panva/node-oidc-provider/blob/main/docs/README.md#interactionspolicy
policy.remove('consent');

let confirmLoginPrompt = new interactionPolicy.Prompt(
  { name: 'confirm-login', requestable: true },
  new interactionPolicy.Check('login_confirmed', 'confirmation is required to proceed with authentication', 'interaction_required', (ctx) => {
    const { oidc } = ctx;
    if (!oidc.client['identityLoginConfirmed']) {
      return interactionPolicy.Check.REQUEST_PROMPT;
    }

    return interactionPolicy.Check.NO_NEED_TO_PROMPT;
  })
);
policy.add(confirmLoginPrompt, 0);

// let loginPrompt = policy.get('login');

export default policy;

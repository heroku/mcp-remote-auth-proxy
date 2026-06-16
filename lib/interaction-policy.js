import { interactionPolicy } from 'oidc-provider';

const policy = interactionPolicy.base();

// Accept prompt=consent (RFC 6749 / OIDC Core) without rendering a consent UI.
// Primary Identity collects consent upstream; the proxy resolves the consent
// prompt in the identity callback by calling interactionFinished with
// { consent: { grantId } } (see use-interaction-routes-adapter.js).
policy.remove('consent');
policy.add(new interactionPolicy.Prompt(
  { name: 'consent', requestable: true },
  new interactionPolicy.Check(
    'consent_granted_upstream',
    'consent is collected by primary Identity',
    'consent_required',
    () => interactionPolicy.Check.NO_NEED_TO_PROMPT
  )
));

let confirmLoginPrompt = new interactionPolicy.Prompt(
  { name: 'confirm-login', requestable: true },
  new interactionPolicy.Check(
    'is_login_confirmed',
    'confirmation is required to proceed with authentication',
    'interaction_required',
    (ctx) => {
      const { oidc } = ctx;
      if (!oidc.client['identityLoginConfirmed']) {
        return interactionPolicy.Check.REQUEST_PROMPT;
      }

      return interactionPolicy.Check.NO_NEED_TO_PROMPT;
    }
  )
);
policy.add(confirmLoginPrompt, 0);

// let loginPrompt = policy.get('login');

export default policy;

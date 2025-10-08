// Branding configuration for the authentication proxy
// This module handles all branding-related settings and provides
// conditional branding based on the OAuth provider

// Detect if Heroku is the OAuth provider
function isHerokuProvider() {
  const { IDENTITY_SERVER_URL } = process.env;

  const domainPattern = /(heroku|herokudev).com$/i;
  return IDENTITY_SERVER_URL && domainPattern.test(IDENTITY_SERVER_URL);
}

// Get branding configuration based on provider
function getBrandingConfig() {
  const { BRANDING_TITLE = 'Login for Model Context Protocol', BRANDING_FAVICON } = process.env;

  const isHeroku = isHerokuProvider();

  if (isHeroku) {
    // Heroku branding
    return {
      title: `${BRANDING_TITLE} | Heroku`,
      favicon: 'https://www.herokucdn.com/favicon.ico',
      logo: `<svg width=85 height=24 xmlns="http://www.w3.org/2000/svg">
        <g class=info fill-rule=evenodd>
          <path
            d="M27.8866 16.836h2.373v-3.504h2.919v3.504h2.373V8.164h-2.373v3.2227h-2.919V8.164h-2.373v8.672zm10.4888 0h6.4666V14.949h-4.0935v-1.6054h2.7764v-1.8282h-2.7765v-1.4062h3.8918V8.164h-6.265v8.672zm8.8396 0h2.3256V13.824h.6526L51.89 16.836h2.5154l-1.863-3.3165c1.151-.3867 1.7325-1.1718 1.7325-2.5312 0-2.086-1.3765-2.8242-3.631-2.8242h-3.429v8.672zm2.3256-4.793v-1.9805h1.0204c.973 0 1.4.2578 1.4.9844 0 .7264-.427.996-1.4.996h-1.0204zM60.8363 17c2.112 0 4.307-1.3242 4.307-4.5 0-3.1758-2.195-4.5-4.307-4.5-2.124 0-4.319 1.3242-4.319 4.5 0 3.1758 2.195 4.5 4.319 4.5zm0-1.875c-1.2458 0-1.946-1.0313-1.946-2.625 0-1.5938.7002-2.5664 1.946-2.5664 1.234 0 1.934.9726 1.934 2.5664 0 1.5938-.7 2.625-1.934 2.625zm6.7157 1.711h2.373v-2.6954l.6764-.7734 2.0764 3.4687h2.6816l-3.2155-5.25 2.9543-3.422h-2.7527l-2.4205 3.1407V8.164h-2.373v8.672zm13.4552.1288c2.563 0 3.6782-1.3125 3.6782-3.6093V8.164H82.36v5.1798c0 1.1953-.3798 1.7343-1.329 1.7343-.9493 0-1.3408-.539-1.3408-1.7342V8.164h-2.373v5.1915c0 2.2968 1.127 3.6093 3.69 3.6093zM2.4444 0C.9214 0 0 .8883 0 2.3226v19.3548C0 23.1068.9215 24 2.4444 24h17.1112C21.0736 24 22 23.1117 22 21.6774V2.3226C21.995.8883 21.0735 0 19.5556 0H2.4444zm16.8973 1.9c.4025.0045.7583.3483.7583.7214v18.7572c0 .3776-.3558.7214-.7583.7214H2.6583c-.4025 0-.7583-.3438-.7583-.7214V2.6214c0-.3777.3558-.7214.7583-.7214h16.6834z" />
          <path
            d="M16.43 20h-2.2527v-6.8048c0-.619-.1917-.838-.3786-.9666-1.131-.7667-4.3855-.0334-6.3458.7333l-1.553.6475L5.9048 4h2.2814v6.3333c.4314-.1333.973-.2714 1.524-.3857 2.4206-.5143 4.1987-.3762 5.3586.4048.6375.4286 1.3612 1.2714 1.3612 2.8428V20zM11.57 8h2.6675c1.4042-1.75 1.9732-3.35 2.1925-4h-2.6623c-.3967.95-1.1223 2.55-2.1977 4zM5.9 20v-5.6l2.43 2.8L5.9 20z" />
        </g>
      </svg>`,
      colors: {
        primary: '#8363a1',
        secondary: '#74a8c3',
        background: 'linear-gradient(135deg, #8363a1 0%, #74a8c3 100%)',
        text: '#fff',
        textMuted: 'rgba(255, 255, 255, 0.6)',
        border: 'rgba(255, 255, 255, 0.9)',
      },
    };
  } else {
    // Generic branding
    return {
      title: BRANDING_TITLE,
      favicon: BRANDING_FAVICON,
      logo: `<svg width=120 height=32 xmlns="http://www.w3.org/2000/svg">
        <text x="0" y="24" font-family="Arial, sans-serif" font-size="20" font-weight="bold" fill="#4a5568">
          MCP Auth
        </text>
      </svg>`,
      colors: {
        primary: '#a7bcd9',
        secondary: '#718096',
        background: 'linear-gradient(135deg, #f7fafc 0%, #e2e8f0 100%)',
        text: '#2d3748',
        textMuted: '#718096',
        border: '#bbc2c9',
      },
    };
  }
}

export { getBrandingConfig, isHerokuProvider };
export default getBrandingConfig;

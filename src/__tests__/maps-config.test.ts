const { mapsPluginOptions } = require('../../scripts/maps-config.cjs');
const { execFileSync } = require('node:child_process');

test('example keys do not enable the iOS Google SDK', () => {
  expect(mapsPluginOptions({ EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY: 'YOUR-IOS-MAPS-KEY' })).toEqual({
    androidGoogleMapsApiKey: undefined,
    iosGoogleMapsApiKey: undefined,
  });
});

test('Expo config registers the Maps plugin with separate native keys', () => {
  const previous = { ...process.env };
  try {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY = 'android-test-key';
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY = 'ios-test-key';
    const exp = JSON.parse(
      execFileSync(
        process.execPath,
        [
          '-e',
          "const {exp}=require('@expo/config').getConfig(process.cwd()); console.log(JSON.stringify({plugins:exp.plugins,android:{package:exp.android.package},ios:{bundleIdentifier:exp.ios.bundleIdentifier}}));",
        ],
        { env: process.env, encoding: 'utf8' },
      ),
    );
    expect(exp.plugins).toContainEqual([
      'react-native-maps',
      {
        androidGoogleMapsApiKey: 'android-test-key',
        iosGoogleMapsApiKey: 'ios-test-key',
      },
    ]);
    expect(exp.android.package).toBe('com.guardians.app');
    expect(exp.ios.bundleIdentifier).toBe('com.guardians.app');
  } finally {
    process.env = previous;
  }
});

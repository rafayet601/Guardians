// Native SDK setup must agree with the provider selected by PlatformMap.
function mapsPluginOptions(env) {
  const key = (value) => (value && !value.includes('YOUR-') ? value : undefined);
  return {
    androidGoogleMapsApiKey: key(env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY),
    iosGoogleMapsApiKey: key(env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY),
  };
}

module.exports = { mapsPluginOptions };

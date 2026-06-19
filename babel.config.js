module.exports = function (api) {
  api.cache(true);
  return {
    // babel-preset-expo automatically wires up expo-router and the
    // react-native-worklets/reanimated babel plugin for SDK 56.
    presets: ['babel-preset-expo'],
  };
};

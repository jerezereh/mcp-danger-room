module.exports = [
  {
    test: /\.node$/,
    use: 'node-loader',
  },
  {
    test: /\.(m?js|node)$/,
    parser: { amd: false },
    resolve: {
      fullySpecified: false,
    },
    use: {
      loader: '@marshallofsound/webpack-asset-relocator-loader',
      options: {
        outputAssetBase: 'native_modules',
      },
    },
  },
  {
    test: /\.(js|ts|tsx)$/,
    exclude: /node_modules/,
    use: {
      loader: 'babel-loader',
    },
  },
  {
    test: /\.(png|svg|jpg|jpeg|gif)$/i,
    type: 'asset/resource',
  },
  {
    test: /\.s[ac]ss$/i,
    use: [
      {
        // Creates `style` nodes from JS strings
        loader: 'style-loader',
      },
      {
        // Translates CSS into CommonJS
        loader: 'css-loader',
      },
      {
        // Compiles Sass to CSS
        loader: 'sass-loader',
      },
    ],
  },
];

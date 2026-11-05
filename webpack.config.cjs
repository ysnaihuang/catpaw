const path = require('path');

module.exports = {
  mode: 'production',
  target: 'node',
  entry: './src/index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'index.js',
    library: {
      type: 'commonjs2',
    },
  },
  resolve: {
    alias: {
      'util/req.js': path.resolve(__dirname, 'src/util/req.js'),
    },
  },
  optimization: {
    minimize: true,
  },
};

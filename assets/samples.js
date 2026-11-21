/* Example manifests used by the "载入示例" button.
 * Kept small so a first run finishes in a few seconds. */
(function (root) {
  var samples = [
    {
      label: '典型 2021 年前端项目（多半已经过时）',
      body: {
        name: 'legacy-admin-dashboard',
        version: '2.4.0',
        dependencies: {
          'react': '^17.0.2',
          'react-dom': '^17.0.2',
          'axios': '^0.21.1',
          'moment': '^2.29.1',
          'lodash': '^4.17.21',
          'express': '^4.17.1',
          'request': '^2.88.2'
        },
        devDependencies: {
          'webpack': '^4.46.0',
          'node-sass': '^5.0.0',
          'typescript': '^4.5.0'
        }
      }
    },
    {
      label: '现代 TypeScript 服务（看起来没问题）',
      body: {
        name: 'modern-api',
        version: '1.0.0',
        dependencies: {
          'fastify': '^4.0.0',
          'zod': '^3.22.0',
          'pino': '^8.0.0'
        },
        devDependencies: {
          'typescript': '^5.3.0',
          'vitest': '^1.0.0'
        }
      }
    }
  ];

  root.DepSamples = samples;
})(typeof globalThis !== 'undefined' ? globalThis : this);

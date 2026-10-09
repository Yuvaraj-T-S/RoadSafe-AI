import { generateDemoAccidents } from './src/data';
import * as fs from 'fs';

const data = generateDemoAccidents(1200);
const headers = Object.keys(data[0]).join(',');
const rows = data.map(d => Object.values(d).join(','));
fs.writeFileSync('accidents.csv', [headers, ...rows].join('\n'));
console.log('CSV created');

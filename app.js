import axios from 'axios';
import dotenv, { configDotenv } from 'dotenv';
dotenv.config();
import {display, Font, Color, Layer } from 'ssd1306-i2c-js';
import * as config from './config.js';

// ***********************************************
// FUNCTIONS

/**
 *
 * @param {string} url
 * @param {object} auth 'auth' option to pass to axios
 * @param {function} filter optional function to filter response
 * @returns
 */
function getData(url, auth, filter) {
  return new Promise((resolve, reject) => {
    let val;
    const options = { auth: auth || null };
    axios
      .get(url, options)
      .then((response) => {
        // Call the filter function
        val = filter(response);
        // Return the value value
        resolve(val);
      })
      .catch((error) => {
        console.error(error);
      });
  });
}

/**
 * Affine transformation (y = mx + b)
 * Given a number, a domain and a range
 * this will do an affine transformation with stops
 * at range[0] and range[1].
 * @param {number} x
 * @param {array} domain - possible input value endpoints
 * @param {array} range - possible output value endpoints
 * @returns {number} y (rounded to 2 decimal places)
 */
function affine(x, domain, range) {
  let y =
    ((range[1] - range[0]) / (domain[1] - domain[0])) * (x - domain[0]) +
    range[0];
  // Round to 2 decimal places
  y = y.toFixed(2);
  // Stops at range[0] and range[1]
  y = y <= range[1] ? y : range[1];
  y = y >= range[0] ? y : range[0];
  return y;
}

function updateDisplay(display, label, values, range){
  // display.drawPixel(x, y, color, layer);
  // display.drawLine(x, y, x1, y1, color, layer);
  // display.drawRect(x, y, w, h, color, layer);
  // display.fillRect(x, y, w, h, color, layer);
  // display.drawString(x:number, y:number, text, size, color, layer);
  console.log(`Rendering: ${JSON.stringify(values)}}`)
  display.clearScreen(); // Clear display buffer

  // The text
  display.drawString(
    34, // left
    0, // top
    `${label.toUpperCase()}: ${values[values.length - 1].toString()}`, // string
    1, // font size
    Color.White,
    Layer.Layer0
  );

  // The chart
  const textHeight = 15; // The yellow stuff (leave 1 px for the top of the columns)
  const columnHeight = config.displayHeight - textHeight;
  const columnWidth = Math.floor(config.displayWidth / values.length);
  values.forEach((value, index) => {
    const x = (columnWidth * index);
    const valHeight = affine(value, range, [0, columnHeight - 1]); // Leave a space at the bottom for the column bases
    const colTop = config.displayHeight - valHeight;
    // Fill the value columns
    display.fillRect(x, colTop, columnWidth-1, valHeight ,Color.White, Layer.Layer0)
    // Fill the column bases
    display.fillRect(x, config.displayHeight-1, columnWidth-1, 1 ,Color.White, Layer.Layer0)

  })

  display.refresh();
}

/**
 * @param {object} display An initialized display object
 * @param {string} dataType The type of data (from config.js)
 * @param {number} val The value to display (string or number)
 * @param {array} range The min/max values (array of two numbers)
 */
// function updateDisplay(display, dataType, val, range) {
//   // Make sure val is within range
//   if (val === null) {
//     val = range[0];
//   } else if (val < range[0]) {
//     val = range[0];
//   } else if (val > range[1]) {
//     val = range[1];
//   }
//   const fontSize = 5;
//   const valStr = val.toString();
//   // Where to start the value display
//   const dataStringStart = 64 - (valStr.length / 2) * 20;
//   const titleStringStart = 64 - (dataType.length / 2) * 5;
//   // The width of our top bar (at least one px)
//   const width = Math.max(
//     parseInt((128 * (val || range[0])) / range[1] - range[0]),
//     1
//   );
//   display.clearScreen(); // Clear display buffer

//   // Render the title
//   display.drawString(
//     titleStringStart,
//     0,
//     dataType.toUpperCase(),
//     1.5,
//     Color.White,
//     Layer.Layer0
//   );

//   // Render the value
//   // display.drawRect(0, 0, width, 12, Color.White, Layer.Layer0);
//   // Render the text
//   display.drawString(
//     dataStringStart,
//     17,
//     valStr,
//     fontSize,
//     Color.White,
//     Layer.Layer0
//   );
//   display.refresh();
// }

// ***********************************************
// STARTUP

// Do we have what we need to run?
if (
  display &&
  process.env.DATA_TYPE &&
  config.sources[process.env.DATA_TYPE] &&
  config.sources[process.env.DATA_TYPE].url
) {
  const dataType = process.env.DATA_TYPE;
  const source = config.sources[dataType];

  // Set some defaults if not provided
  const dataInterval = source.dataInterval || 60; // seconds
  const samplesToShow = source.samplesToShow || 10
  let minMax = source.minMax || [0, 10]; // NOTE: mutable

  // Populate the history array with zeroes
  let history = Array(samplesToShow).fill(0);

  console.log('Initializing display');
  display.init(1, config.displayAddress);
  display.setFont(Font.UbuntuMono_8ptFontInfo);
  display.turnOn();
  display.refresh();

  // Render a starting value
  updateDisplay(display, dataType, history, minMax);

  // This is the main data loop, running continuously at 'dataInterval' seconds
  setInterval(async () => {
    let val = await getData(source.url, source.auth, source.filter);

    // Do we need to move the min/max range wider?
    if (val < minMax[0]) minMax[0] = val;
    if (val > minMax[1]) minMax[1] = val;

    // Update the history array
    history.push(val);

    // Keep only the last `samplesToShow values
    if (history.length > samplesToShow) {
      history.shift();
    }

    // Send something to the OLED display
    updateDisplay(display, dataType, history, minMax);

    // If there's a callback, pass it the value
    if (source.callback) {
      source
        .callback(val)
        .then((response) => {
          // console.log('Callback Finished');
        })
        .catch((error) => {
          console.log(
            'Callback error:',
            error.response.status,
            error.response.statusText
          );
        });
    }
  }, dataInterval * 1000);
} else {
  console.log('Error: missing config. Stopping.');
}
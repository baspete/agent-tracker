import axios from 'axios';
import dotenv from 'dotenv';
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
 * @param {object} display An initialized display object
 * @param {string} dataType The type of data (from config.js)
 * @param {number} val The value to display (string or number)
 * @param {array} range The min/max values (array of two numbers)
 */
function updateDisplay(display, dataType, val, range) {
  // Don't bother if we don't have a display
  if (!display) return;
  // Make sure val is within range
  if (val === null) {
    val = range[0];
  } else if (val < range[0]) {
    val = range[0];
  } else if (val > range[1]) {
    val = range[1];
  }
  const fontSize = 5;
  const valStr = val.toString();
  // Where to start the value display
  const dataStringStart = 64 - (valStr.length / 2) * 20;
  const titleStringStart = 64 - (dataType.length / 2) * 5;
  // The width of our top bar (at least one px)
  const width = Math.max(
    parseInt((128 * (val || range[0])) / range[1] - range[0]),
    1
  );
  display.clearScreen(); // Clear display buffer

  // Render the title
  display.drawString(
    titleStringStart,
    0,
    dataType.toUpperCase(),
    1.5,
    Color.White,
    Layer.Layer0
  );

  // Render the value
  // display.drawRect(0, 0, width, 12, Color.White, Layer.Layer0);
  // Render the text
  display.drawString(
    dataStringStart,
    17,
    valStr,
    fontSize,
    Color.White,
    Layer.Layer0
  );
  display.refresh();
}

// ***********************************************
// STARTUP

// Do we have what we need to run?
if (
  config.dataType &&
  config.sources[config.dataType] &&
  config.sources[config.dataType].url
) {
  const source = config.sources[config.dataType];

  // Set some defaults if not provided
  const dataInterval = source.dataInterval || 60; // seconds
  const samplesToAverage = source.samplesToAverage || 1;
  let minMax = source.minMax || [0, 10]; // NOTE: mutable

  // This will hold the last few measurements, so
  // we can calculate a running average for noisy data.
  let history = [];

  console.log('Initializing display');
  display.init(1, config.displayAddress);
  display.setFont(Font.UbuntuMono_8ptFontInfo);
  display.turnOn();
  display.refresh();

  // Render a starting value
  updateDisplay(display, config.dataType, '--', minMax);

  // This is the main data loop, running continuously at 'dataInterval' seconds
  setInterval(async () => {
    let val = await getData(source.url, source.auth, source.filter);

    // Do we need to move the min/max range wider?
    if (val < minMax[0]) minMax[0] = val;
    if (val > minMax[1]) minMax[1] = val;

    // Update the history array
    history.push(val);

    // Keep only the last `samplesToAverage` values
    if (history.length > samplesToAverage) {
      history.shift();
    }

    // Log something useful to the console
    console.info(
      config.dataType,
      history,
      `(${minMax[0]}-${minMax[1]})`
    );

    // Send something to the OLED display
    updateDisplay(display, config.dataType, val, minMax);

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
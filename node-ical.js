'use strict';

const ical = require('./ical');
const request = require('request');
const fs = require('fs');
const rrule = require('rrule').RRule;


exports.fromURL = (url, opts, cb)=>{
	if (!cb) return;

	request(url, opts, (err, r, data)=>{
		if (err) return cb(err, null);
		if (r.statusCode != 200) return cb(r.statusCode + ": " + r.statusMessage, null);
		cb(undefined, ical.parseICS(data));
	});
};

exports.parseFile = filename=>ical.parseICS(fs.readFileSync(filename, 'utf8'));


ical.objectHandlers['RRULE'] = (val, params, curr, stack, line)=>{
	curr.rrule = line;
	return curr
};

const originalEnd = ical.objectHandlers['END'];

ical.objectHandlers['END'] = (val, params, curr, stack)=>{
	// Recurrence rules are only valid for VEVENT, VTODO, and VJOURNAL.
	// More specifically, we need to filter the VCALENDAR type because we might end up with a defined rrule
	// due to the subtypes.
	if ((val === "VEVENT") || (val === "VTODO") || (val === "VJOURNAL")) {
		if (curr.rrule) {
			let rule = curr.rrule.replace('RRULE:', '');
			if (rule.indexOf('DTSTART') === -1) {

				if (curr.start.length === 8) {
					var comps = /^(\d{4})(\d{2})(\d{2})$/.exec(curr.start);
					if (comps) curr.start = new Date(comps[1], comps[2] - 1, comps[3]);
				}


				if (typeof curr.start.toISOString === 'function') {
					try {
						rule += ';DTSTART=' + curr.start.toISOString().replace(/[-:]/g, '');
						rule = rule.replace(/\.[0-9]{3}/, '');
					} catch (error) {
						console.error("ERROR when trying to convert to ISOString", error);
					}
				} else {
					console.error("No toISOString function in curr.start", curr.start);
				}
			}
			curr.rrule = rrule.fromString(rule);
		}
	}
	return originalEnd.call(this, val, params, curr, stack);
};

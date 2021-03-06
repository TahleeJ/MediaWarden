self.importScripts("./stopwatch.js");
self.importScripts("./popup.js");

const media_blacklist_sites = ["https://www.facebook.com", "https://www.instagram.com", "https://www.reddit.com", "https://www.twitter.com", "https://www.youtube.com", "https://tiktok.com"];
var media_blacklist_active_tabs = new Map();
var warden_shutdown = false;
const warden_timer_threshold = 15;
var warden_timer = warden_timer_threshold;
var decrementedTime = warden_timer * 60;

chrome.storage.local.get("session_time_sum", function(result) {
    if (result == null) {
        createNewStorage();
    }
});

chrome.runtime.onInstalled.addListener(() => {
    createNewStorage();
});

function createNewStorage() {
    setWardenAlarm();

    chrome.storage.local.set({
        "session_time_sum": "",
        "total_sessions": 0,
        "average": 0,
        "time_scale": "s"
    }, function() {
        chrome.storage.local.get("session_time_sum", function(data) {
            console.log(`Create new storage: ${data.session_time_sum}`);
        })     
    });
}

// Listen for new tabs being created
chrome.tabs.onCreated.addListener((tab) =>{
    if (tab.status = "complete") {
        if (tab.url != null) {
            console.log(`New tab created: ${tab.url}`);
        }
    }
});


// Listen for tabs being updated with respect to their url
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tab.status = "complete") {
        if (changeInfo.url != null) {
            // Check if the current tab is for a blacklisted site and newly created or not
            if (!media_blacklist_active_tabs.has(tab.id)) {
                console.log(`Tab has been updated: ${tab.url}`);

                // Check if the tab's url is one for one of the blacklisted social media sites
                if(cycleSites(tab)) {
                    console.log(`You have opened a tab for ${url}`);
                }
            } else if (chrome.tabs.get(tabId).active == true) {
                if (cycleSites(tab)) {
                    console.log(`You have opened a tab for ${url}`);
                }
            } else if (!changeInfo.url.includes(media_blacklist_active_tabs.get(tab.id).original_url)) {
                // Handle the tab's url changing, the "pseudo-session" for the tab
                console.log(`You have left ${media_blacklist_active_tabs.get(tab.id).original_url}`);

                let is_blacklist = false;

                // Check if the new url is still for a blacklisted site
                media_blacklist_sites.forEach(url => {
                    if (changeInfo.url.includes(url)) {
                        is_blacklist = true;
                        // Change the tab's "original" url to the current url
                        media_blacklist_active_tabs.get(tab.id).original_url = url;
                        console.log(`You have moved to new blacklisted site: ${url}`);
                    }
                });

                // Handle the tab's new url not being a part of the blacklisted site collection
                if (!is_blacklist) {
                    // Remove tab from "blacklisted tabs" collection
                    media_blacklist_active_tabs.delete(tab.id);
                    console.log("This tab has left all blacklisted sites.");

                    checkEndSession();
                }
            }
        } 
    }
});

// Listen for blacklisted tabs being closed
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    if (media_blacklist_active_tabs.has(tabId)) {
        console.log(`You have left blacklisted site: ${media_blacklist_active_tabs.get(tabId).original_url}`);

        media_blacklist_active_tabs.delete(tabId);
        console.log("This tab has left all blacklisted sites.");

        checkEndSession("All active blacklisted tabs in this session have been navigated away from.");
    }
});

chrome.tabs.onActivated.addListener((activeInfo) => handleActive(activeInfo));

async function handleActive(activeInfo) {
    chrome.tabs.get(activeInfo.tabId, async(tab) => {
        let status = tab.status;

        while (tab.status != "complete") {
            await chrome.tabs.update(activeInfo.tabId, { status });
        }

        if (cycleSites(tab)) {
            console.log(`You have opened a tab for ${tab.url}`);
        }
    });
}

function cycleSites(tab) {
    let is_blacklist = false;

    media_blacklist_sites.forEach((site_url) => {
        if (tab.url.includes(site_url)) {
            if (media_blacklist_active_tabs.size == 0) {
                startStopwatch();
                chrome.alarms.create("shutdown", {delayInMinutes : warden_timer});
                chrome.alarms.create("update", {when : 1000, periodInMinutes : (1/60)});
                chrome.alarms.onAlarm.addListener((alarm) => {
                    if (alarm.name == "shutdown") {
                        wardenShutdown(tab.id);
                        chrome.alarms.clearAll();
                    } else {
                        updateTimeDisplay(decrementedTime);
                        decrementedTime--;
                    }      
                });
            }

            console.log("Reached blocked webpage");

            // Add tab to "blacklisted tabs" collection if it is on a blacklisted site
            media_blacklist_active_tabs.set(tab.id, {"original_url": tab.url});

            if (warden_shutdown) {
                wardenShutdown(tab.id);
            }

            is_blacklist = true;
        }

        return is_blacklist;
    });
}

function checkEndSession(logText) {
    if (media_blacklist_active_tabs.size == 0) {
        console.log(logText);

        var new_session_time = stopStopwatch();
        resetStopwatch();
        setWardenAlarm();
        chrome.alarms.clearAll();
        warden_shutdown = false;
        
        chrome.storage.local.get("session_time_sum", function(new_sum) {
            var prev_session_sum = new_sum.session_time_sum;

            chrome.storage.local.get("total_sessions", function(new_total) {
                var new_total_sessions = new_total.total_sessions + 1;

                chrome.storage.local.set({"total_sessions" : new_total_sessions}, function() {
                    timeSummary = generateTimeSum(prev_session_sum, new_session_time);

                    chrome.storage.local.set({"session_time_sum" : timeSummary[0][0]}, function() {
                        console.log(timeSummary[1][1]);
                        chrome.storage.local.set({"average" : timeSummary[1][1] / new_total_sessions}, function() {
                            chrome.storage.local.set({"time_scale" : timeSummary[1][0]}, function() {
                                chrome.storage.local.get("average", function(new_average) {
                                    console.log(`Your session time was: ${new_session_time} and your new session average is ${new_average.average} ${timeSummary[1][0] == "m" ? "minutes" : "seconds"}`);
                                });
                            });
                        });
                    });
                });
            });
        });
    }
}

function generateTimeSum(oldSum, newSession) {
    var oldSumTimeDenom = oldSum.split(":");
    var newSessionTimeDenom = newSession.split(":");

    let hourSum = parseInt(newSessionTimeDenom[0]);
    let minuteSum = parseInt(newSessionTimeDenom[1]);
    let secondSum = parseInt(newSessionTimeDenom[2]);

    if (oldSumTimeDenom.length > 1) {
        hourSum += parseInt(oldSumTimeDenom[0]);
        minuteSum += parseInt(oldSumTimeDenom[1]);
        secondSum += parseInt(oldSumTimeDenom[2]);
    }

    if (secondSum >= 60) {
        secondSum -= 60;
        minuteSum++;
    }

    if (minuteSum >= 60) {
        minuteSum -= 60;
        hourSum++;
    }

    var newSum = [`${hourSum}:${minuteSum}:${secondSum}`, undefined];

    var newSumInt = [];

    if (hourSum > 0 || minuteSum > 0) {
        newSumInt = ["m", hourSum * 60 + minuteSum];
    } else {
        newSumInt = ["s", secondSum];
    }

    var result = [newSum, newSumInt];

    return result;
}

function wardenShutdown(tabId) {
    warden_shutdown = true;
   
    chrome.scripting.insertCSS({target: {tabId: tabId}, css: "html { -webkit-filter: saturate(7) blur(1px) contrast(180%); -moz-filter: saturate(7) blur(1px) contrast(180%); filter: saturate(7) blur(1px) contrast(180%);}"});
}

function setWardenAlarm() {
    chrome.storage.local.get("average", function(avg) {
       chrome.storage.local.get("time_scale", function(scale) {
            if (scale.time_scale == "s") {
                if (avg.average < warden_timer_threshold && avg.average > 5) {
                    warden_timer = avg.average;
                } else {
                    warden_timer = warden_timer_threshold;
                }
            }

            warden_timer /= 60;
            decrementedTime = warden_timer * 60;
       });
    });
}